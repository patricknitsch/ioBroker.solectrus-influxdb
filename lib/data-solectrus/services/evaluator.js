/* eslint-disable jsdoc/require-jsdoc */
'use strict';

// Evaluates item values (source mode + formula mode + state-machine mode) and applies output shaping.
// Intentionally kept pure-ish: it only reads via the provided adapter.

const { getItemOutputId, getItemDisplayId } = require('./itemIds');
const { evaluateStateMachine } = require('../stateMachine');

function createFormulaFunctions(adapter) {
	return {
		min: Math.min,
		max: Math.max,
		pow: Math.pow,
		abs: Math.abs,
		round: Math.round,
		floor: Math.floor,
		ceil: Math.ceil,
		// IF(condition, valueIfTrue, valueIfFalse)
		IF: (condition, valueIfTrue, valueIfFalse) => (condition ? valueIfTrue : valueIfFalse),
		if: (condition, valueIfTrue, valueIfFalse) => (condition ? valueIfTrue : valueIfFalse),
		clamp: (value, min, max) => {
			const v = Number(value);
			const lo = Number(min);
			const hi = Number(max);
			if (!Number.isFinite(v)) {
				return 0;
			}
			if (Number.isFinite(lo) && v < lo) {
				return lo;
			}
			if (Number.isFinite(hi) && v > hi) {
				return hi;
			}
			return v;
		},

		// Read a foreign state value by id from cache/snapshot (raw, but restricted to primitives).
		v: id => {
			const key = String(id);
			const val =
				adapter.currentSnapshot && typeof adapter.currentSnapshot.get === 'function'
					? adapter.currentSnapshot.get(key)
					: adapter.cache.get(key);
			if (val === null || val === undefined) {
				return val;
			}
			const t = typeof val;
			if (t === 'string' || t === 'number' || t === 'boolean') {
				return val;
			}
			if (val instanceof Date && typeof val.toISOString === 'function') {
				return val.toISOString();
			}
			adapter.debugOnce(
				`v_non_primitive|${key}`,
				`v("${key}") returned non-primitive (${t}); treating as empty string`,
			);
			return '';
		},

		// Extract a primitive value from a JSON payload using the adapter's minimal JSONPath subset.
		jp: (id, jsonPath) => {
			const key = String(id);
			const raw =
				adapter.currentSnapshot && typeof adapter.currentSnapshot.get === 'function'
					? adapter.currentSnapshot.get(key)
					: adapter.cache.get(key);
			const jp = jsonPath !== undefined && jsonPath !== null ? String(jsonPath).trim() : '';
			if (!jp) {
				return undefined;
			}

			let obj = null;
			if (raw && typeof raw === 'object') {
				obj = raw;
			} else if (typeof raw === 'string') {
				const s = raw.trim();
				if (!s) {
					return undefined;
				}
				try {
					obj = JSON.parse(s);
				} catch (e) {
					adapter.debugOnce(
						`jp_parse_failed|${key}|${jp}`,
						`jp("${key}", "${jp}") cannot parse JSON: ${e && e.message ? e.message : e}`,
					);
					return undefined;
				}
			} else {
				return undefined;
			}

			const extracted = adapter.applyJsonPath(obj, jp);
			if (extracted === undefined || extracted === null) {
				return extracted;
			}
			const t = typeof extracted;
			if (t === 'string' || t === 'number' || t === 'boolean') {
				return extracted;
			}
			if (extracted instanceof Date && typeof extracted.toISOString === 'function') {
				return extracted.toISOString();
			}
			return undefined;
		},

		// Read a foreign state value by id from cache (sync, safe numeric).
		s: id => {
			const key = String(id);
			if (adapter.currentSnapshot && typeof adapter.currentSnapshot.get === 'function') {
				return adapter.safeNum(adapter.currentSnapshot.get(key));
			}
			return adapter.safeNum(adapter.cache.get(key));
		},
	};
}

function isNumericOutputItem(item) {
	const t = item && item.type ? String(item.type) : '';
	// Only these should be forced numeric and get clamping/noNegative rules.
	return t === '' || t === 'number';
}

function getZeroValueForItem(item) {
	const t = item && item.type ? String(item.type) : '';
	if (t === 'string') {
		return '';
	}
	if (t === 'boolean') {
		return false;
	}
	return 0;
}

async function computeItemValue(adapter, item, snapshot) {
	const mode = item.mode || 'formula';

	if (mode === 'source') {
		const id = item.sourceState ? String(item.sourceState) : '';
		const raw = snapshot ? snapshot.get(id) : adapter.cache.get(id);

		// Source-mode supports both numeric (default) and non-numeric outputs.
		// For numeric outputs we keep the existing behavior (numeric extraction + optional output clamp).
		if (isNumericOutputItem(item)) {
			let v = adapter.getNumericFromJsonPath(
				raw,
				item && item.jsonPath,
				`item|${id}|${item && item.targetId ? item.targetId : ''}`,
			);
			// item.noNegative is an OUTPUT rule; for source-mode numeric it's equivalent to clamping the mirrored value.
			if (item && item.noNegative && v < 0) {
				v = 0;
			}
			return v;
		}

		const hasJsonPath =
			item && item.jsonPath !== undefined && item.jsonPath !== null && String(item.jsonPath).trim() !== '';
		const value = hasJsonPath
			? adapter.getValueFromJsonPath(
					raw,
					item && item.jsonPath,
					`item|${id}|${item && item.targetId ? item.targetId : ''}`,
				)
			: raw;

		// Keep output values safe and predictable: only allow primitives.
		if (value === null || value === undefined) {
			return value;
		}
		const t = typeof value;
		if (t === 'string' || t === 'number' || t === 'boolean') {
			return value;
		}
		if (value instanceof Date && typeof value.toISOString === 'function') {
			return value.toISOString();
		}
		adapter.debugOnce(
			`source_non_primitive|${id}|${item && item.targetId ? item.targetId : ''}`,
			`Source state '${id}' returned non-primitive (${t}); treating as empty string`,
		);
		return '';
	}

	if (mode === 'state-machine') {
		// State-machine mode: evaluate rules and return string/boolean output
		const targetId = getItemOutputId(item);
		const compiled = targetId ? adapter.compiledItems.get(targetId) : null;

		if (compiled && compiled.ok && compiled.compiledRules) {
			return evaluateStateMachine(adapter, item, snapshot, compiled.compiledRules, compiled.defaultValue);
		}

		if (compiled && !compiled.ok) {
			throw new Error(compiled.error || 'State machine compile failed');
		}

		// Fallback if not compiled (shouldn't happen normally)
		const itemType = item && item.type ? String(item.type) : 'string';
		return itemType === 'boolean' ? false : '';
	}

	const inputs = Array.isArray(item.inputs) ? item.inputs : [];
	const vars = Object.create(null);

	for (const inp of inputs) {
		if (!inp || typeof inp !== 'object') {
			continue;
		}
		const keyRaw = inp.key ? String(inp.key).trim() : '';
		const key = keyRaw.replace(/[^a-zA-Z0-9_]/g, '_');
		if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
			const itemId = getItemDisplayId(item) || (item && item.name ? String(item.name) : '');
			adapter.debugOnce(
				`blocked_input_key|${itemId}|${key}`,
				`Blocked dangerous input key '${keyRaw}' (sanitized to '${key}') for item '${itemId}'`,
			);
			continue;
		}
		if (!key) {
			continue;
		}

		const id = inp.sourceState ? String(inp.sourceState) : '';
		const raw = snapshot ? snapshot.get(id) : adapter.cache.get(id);
		let value;

		const hasJsonPath =
			inp && inp.jsonPath !== undefined && inp.jsonPath !== null && String(inp.jsonPath).trim() !== '';
		if (hasJsonPath) {
			const extracted = adapter.getValueFromJsonPath(raw, inp && inp.jsonPath, `input|${id}|${key}`);
			if (typeof extracted === 'string') {
				const n = Number(extracted);
				value = Number.isFinite(n) ? n : extracted;
			} else {
				value = extracted;
			}
		} else {
			// Backwards compatible default: inputs without JSONPath are treated as numeric.
			value = adapter.safeNum(raw);
		}

		// Clamp negative inputs BEFORE formula evaluation (only if numeric).
		// Important: item.noNegative is an OUTPUT rule and must not affect inputs.
		// Use per-input noNegative to clamp only those specific sources.
		if (typeof value === 'number' && inp && inp.noNegative && value < 0) {
			value = 0;
		}
		vars[key] = value;
	}

	const expr = item.formula ? String(item.formula).trim() : '';
	if (!expr) {
		return 0;
	}

	// Prefer compiled AST if available.
	const targetId = getItemOutputId(item);
	const compiled = targetId ? adapter.compiledItems.get(targetId) : null;
	if (compiled && compiled.ok) {
		if (compiled.constantValue !== undefined) {
			return compiled.constantValue;
		}
		if (compiled.ast) {
			return adapter.evalFormulaAst(compiled.ast, vars);
		}
		return adapter.evalFormula(expr, vars);
	}
	if (compiled && !compiled.ok) {
		throw new Error(compiled.error || 'Formula compile failed');
	}
	return adapter.evalFormula(expr, vars);
}

function applyResultRules(adapter, item, value) {
	let v = adapter.safeNum(value);

	const toOptionalNumber = val => {
		if (val === undefined || val === null) {
			return NaN;
		}
		if (typeof val === 'string' && val.trim() === '') {
			return NaN;
		}
		const n = Number(val);
		return Number.isFinite(n) ? n : NaN;
	};

	if (item && item.noNegative && v < 0) {
		v = 0;
	}

	if (item && item.clamp) {
		const min = toOptionalNumber(item.min);
		const max = toOptionalNumber(item.max);
		if (Number.isFinite(min) && v < min) {
			v = min;
		}
		if (Number.isFinite(max) && v > max) {
			v = max;
		}
	}

	return v;
}

function castValueForItemType(adapter, item, value) {
	const t = item && item.type ? String(item.type) : '';
	if (t === 'boolean') {
		if (typeof value === 'boolean') {
			return value;
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value !== 0 : false;
		}
		if (typeof value === 'string') {
			const s = value.trim().toLowerCase();
			if (s === 'true' || s === 'on' || s === 'yes' || s === '1') {
				return true;
			}
			if (s === 'false' || s === 'off' || s === 'no' || s === '0' || s === '') {
				return false;
			}
			const n = Number(value);
			return Number.isFinite(n) ? n !== 0 : false;
		}
		return false;
	}
	if (t === 'string') {
		if (value === undefined || value === null) {
			return '';
		}
		return String(value);
	}
	if (t === 'mixed') {
		return value;
	}
	return adapter.safeNum(value);
}

module.exports = {
	createFormulaFunctions,
	isNumericOutputItem,
	getZeroValueForItem,
	computeItemValue,
	applyResultRules,
	castValueForItemType,
};
