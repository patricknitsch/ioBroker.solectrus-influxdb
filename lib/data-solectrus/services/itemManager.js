'use strict';

// Manages item preparation: state creation, formula compilation, subscriptions and initial reads.
// This is the "setup" side; the actual evaluation happens in tickRunner/evaluator.

const { parseExpression } = require('../formula');
const { normalizeFormulaExpression: normalizeFormulaExpressionImpl } = require('../formula');
const { compileStateMachine } = require('../stateMachine');
const { getItemOutputId, calcTitle } = require('./itemIds');
const { collectSourceStatesFromItem } = require('./sourceDiscovery');
const stateRegistry = require('./stateRegistry');
const subscriptions = require('./subscriptions');

function getItemsConfigSignature(_adapter, items) {
	const arr = Array.isArray(items) ? items : [];
	// Only include relevant fields; order is stable by array order.
	const normalized = arr
		.filter(it => it && typeof it === 'object')
		.map(it => ({
			enabled: !!it.enabled,
			mode: it.mode || 'formula',
			group: it.group || '',
			targetId: it.targetId || '',
			name: it.name || '',
			type: it.type || '',
			role: it.role || '',
			unit: it.unit || '',
			noNegative: !!it.noNegative,
			clamp: !!it.clamp,
			min: it.min,
			max: it.max,
			sourceState: it.sourceState || '',
			jsonPath: it.jsonPath || '',
			formula: it.formula || '',
			inputs: Array.isArray(it.inputs)
				? it.inputs
					.filter(inp => inp && typeof inp === 'object')
					.map(inp => ({
						key: inp.key || '',
						sourceState: inp.sourceState || '',
						jsonPath: inp.jsonPath || '',
						noNegative: !!inp.noNegative,
					}))
				: [],
			rules: Array.isArray(it.rules)
				? it.rules
					.filter(rule => rule && typeof rule === 'object')
					.map(rule => ({
						condition: rule.condition || '',
						value: rule.value,
					}))
				: [],
		}));
	try {
		return JSON.stringify(normalized);
	} catch {
		// Fallback: should never happen for plain objects
		return String(Date.now());
	}
}

function compileItem(adapter, item) {
	const mode = item && item.mode ? String(item.mode) : 'formula';
	const outputId = getItemOutputId(item);
	const sourceIds = new Set(collectSourceStatesFromItem(adapter, item));

	if (!outputId) {
		return { ok: false, error: 'Missing/invalid targetId', item, outputId: '', mode, sourceIds };
	}

	if (mode === 'source') {
		return { ok: true, item, outputId, mode, sourceIds };
	}

	if (mode === 'state-machine') {
		const compileResult = compileStateMachine(adapter, item);
		if (!compileResult.ok) {
			return {
				ok: false,
				error: compileResult.error,
				item,
				outputId,
				mode,
				sourceIds,
			};
		}
		return {
			ok: true,
			item,
			outputId,
			mode,
			sourceIds,
			compiledRules: compileResult.compiledRules,
			defaultValue: compileResult.defaultValue,
		};
	}

	const exprRaw = item && item.formula !== undefined && item.formula !== null ? String(item.formula).trim() : '';
	if (!exprRaw) {
		// Treat empty formula as constant 0.
		return { ok: true, item, outputId, mode, sourceIds, normalizedExpr: '', ast: null, constantValue: 0 };
	}

	const normalized = normalizeFormulaExpressionImpl(exprRaw);
	if (normalized && normalized.length > adapter.MAX_FORMULA_LENGTH) {
		return {
			ok: false,
			error: `Formula too long (>${adapter.MAX_FORMULA_LENGTH} chars)`,
			item,
			outputId,
			mode,
			sourceIds,
			normalizedExpr: normalized,
		};
	}

	try {
		const ast = parseExpression(String(normalized));
		adapter.analyzeAst(ast);
		return { ok: true, item, outputId, mode, sourceIds, normalizedExpr: normalized, ast };
	} catch (e) {
		return {
			ok: false,
			error: e && e.message ? e.message : String(e),
			item,
			outputId,
			mode,
			sourceIds,
			normalizedExpr: normalized,
		};
	}
}

function ensureCompiledForCurrentConfig(adapter, items) {
	const sig = getItemsConfigSignature(adapter, items);
	if (sig !== adapter.itemsConfigSignature) {
		return prepareItems(adapter);
	}
	return Promise.resolve();
}

async function ensureItemTitlesInInstanceConfig(adapter) {
	try {
		const objId = `system.adapter.${adapter.namespace}`;
		const obj = await adapter.getForeignObjectAsync(objId);
		if (!obj || !obj.native) return;

		const items = Array.isArray(obj.native.items) ? obj.native.items : [];
		const itemsEditor = Array.isArray(obj.native.itemsEditor) ? obj.native.itemsEditor : [];
		const active = items.length ? items : itemsEditor;
		if (!Array.isArray(active)) return;

		let changed = false;
		active.forEach(it => {
			if (!it || typeof it !== 'object') return;
			const expectedTitle = calcTitle(it);
			if (it._title !== expectedTitle) {
				it._title = expectedTitle;
				changed = true;
			}
		});

		// If Admin stored items under itemsEditor, migrate them back into items
		// so runtime + fallback table see the same config.
		if (items.length === 0 && itemsEditor.length > 0) {
			obj.native.items = itemsEditor;
			changed = true;
		}

		if (changed) {
			await adapter.setForeignObjectAsync(objId, obj);
		}
	} catch (e) {
		adapter.log.debug(`Cannot migrate item titles: ${e}`);
	}
}

async function prepareItems(adapter) {
	const items = Array.isArray(adapter.config.items) ? adapter.config.items : [];
	const validItems = items.filter(it => it && typeof it === 'object');
	const enabledItems = validItems.filter(it => !!it.enabled);
	adapter.itemsConfigSignature = getItemsConfigSignature(adapter, items);

	await adapter.setStateAsync('info.diagnostics.itemsTotal', validItems.length, true);
	await adapter.setStateAsync('info.itemsActive', enabledItems.length, true);

	for (const item of validItems) {
		await stateRegistry.ensureOutputState(adapter, item);
	}

	// Compile items once (AST + discovered sourceIds). Errors are stored per item and handled during tick.
	const compiled = new Map();
	for (const item of validItems) {
		const c = compileItem(adapter, item);
		if (c && c.outputId) {
			compiled.set(c.outputId, c);
		}
	}
	adapter.compiledItems = compiled;

	// Ensure per-item info states and publish compile status.
	for (const c of adapter.compiledItems.values()) {
		try {
			await stateRegistry.ensureItemInfoStatesForCompiled(adapter, c);
			const base = stateRegistry.getItemInfoBaseId(c.outputId);
			await adapter.setStateAsync(`${base}.compiledOk`, !!c.ok, true);
			await adapter.setStateAsync(`${base}.compileError`, c.ok ? '' : String(c.error || 'compile failed'), true);
		} catch (e) {
			adapter.log.debug(`Cannot create/update item info states: ${e && e.message ? e.message : e}`);
		}
	}

	const sourceIds = subscriptions.getDesiredSourceIdsForItems(adapter, items);
	subscriptions.syncSubscriptions(adapter, sourceIds);

	for (const id of sourceIds) {
		try {
			const obj = await adapter.getForeignObjectAsync(id);
			if (!obj) {
				adapter.log.warn(`Source state not found: ${id}`);
				continue;
			}

			const state = await adapter.getForeignStateAsync(id);
			if (state) {
				adapter.cache.set(id, state.val);
				adapter.cacheTs.set(id, typeof state.ts === 'number' ? state.ts : Date.now());
			}
		} catch (e) {
			adapter.log.warn(`Cannot subscribe/read ${id}: ${e && e.message ? e.message : e}`);
		}
	}

	if (enabledItems.length === 0) {
		const msg = 'No item is enabled. Please enable at least one item in the adapter configuration.';
		adapter.log.warn(msg);
		await adapter.setStateAsync('info.status', 'no_items_enabled', true);
	} else {
		await adapter.setStateAsync('info.status', 'ok', true);
	}
}

module.exports = {
	getItemsConfigSignature,
	compileItem,
	ensureCompiledForCurrentConfig,
	ensureItemTitlesInInstanceConfig,
	prepareItems,
};
