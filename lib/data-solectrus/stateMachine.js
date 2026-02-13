'use strict';

/**
 * State Machine Module
 *
 * Provides rule-based state generation: evaluate conditions and output strings/booleans.
 * Rules are evaluated top-to-bottom; first matching rule wins.
 *
 * Features:
 * - Multiple condition types (comparison, logical, always-true default)
 * - String and boolean output types
 * - Full integration with adapter's formula system for conditions
 * - Source state discovery from rule conditions
 */

const { parseExpression, normalizeFormulaExpression: normalizeFormulaExpressionImpl } = require('./formula');

/**
 * Extract all source state IDs referenced in state-machine rules.
 *
 * @param {any} adapter - The adapter instance
 * @param {Array} rules - Array of rule objects with condition expressions
 * @returns {Set<string>} Set of state IDs referenced in rules
 */
function extractSourceIdsFromRules(adapter, rules) {
	const sourceIds = new Set();
	if (!Array.isArray(rules)) {
		return sourceIds;
	}

	for (const rule of rules) {
		if (!rule || typeof rule !== 'object') {
			continue;
		}

		const conditionExpr = rule.condition ? String(rule.condition).trim() : '';
		if (!conditionExpr) {
			continue;
		}

		// Parse condition as formula to extract state references
		try {
			const normalized = normalizeFormulaExpressionImpl(conditionExpr);
			const ast = parseExpression(normalized);
			collectStateIdsFromAst(ast, sourceIds);
		} catch (e) {
			// Ignore parse errors here; they'll be caught during compilation
			adapter.debugOnce(
				`stateMachine_parse_error|${conditionExpr}`,
				`Failed to parse state-machine condition for source discovery: ${e && e.message ? e.message : e}`,
			);
		}
	}

	return sourceIds;
}

/**
 * Recursively collect state IDs from AST (s(...), v(...), jp(...) calls).
 *
 * @param {any} node - AST node
 * @param {Set<string>} ids - Set to collect IDs into
 */
function collectStateIdsFromAst(node, ids) {
	if (!node || typeof node !== 'object') {
		return;
	}

	// Function call: s('id'), v('id'), jp('id', 'path')
	if (node.type === 'CallExpression') {
		const callee = node.callee;
		if (
			callee &&
			callee.type === 'Identifier' &&
			(callee.name === 's' || callee.name === 'v' || callee.name === 'jp')
		) {
			const args = node.arguments;
			if (Array.isArray(args) && args.length > 0) {
				const firstArg = args[0];
				if (firstArg && firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
					ids.add(firstArg.value);
				}
			}
		}
	}

	// Recurse into child nodes
	const keys = Object.keys(node);
	for (const key of keys) {
		const val = node[key];
		if (val && typeof val === 'object') {
			if (Array.isArray(val)) {
				for (const item of val) {
					collectStateIdsFromAst(item, ids);
				}
			} else {
				collectStateIdsFromAst(val, ids);
			}
		}
	}
}

/**
 * Compile and validate state-machine rules.
 * Returns compiled rules with parsed ASTs for fast evaluation.
 *
 * @param {any} adapter - The adapter instance
 * @param {any} item - The item configuration
 * @returns {{ok: boolean, error?: string, compiledRules?: Array, defaultValue?: any}} - The item configuration
 */
function compileStateMachine(adapter, item) {
	const rules = Array.isArray(item.rules) ? item.rules : [];
	const itemType = item && item.type ? String(item.type) : 'string';

	if (rules.length === 0) {
		return {
			ok: false,
			error: 'State machine requires at least one rule',
		};
	}

	const compiledRules = [];
	let hasDefaultRule = false;

	for (let i = 0; i < rules.length; i++) {
		const rule = rules[i];
		if (!rule || typeof rule !== 'object') {
			return {
				ok: false,
				error: `Rule ${i + 1}: Invalid rule object`,
			};
		}

		const conditionExpr = rule.condition ? String(rule.condition).trim() : '';
		const outputValue = rule.value;

		// Validate output value
		if (outputValue === undefined || outputValue === null) {
			return {
				ok: false,
				error: `Rule ${i + 1}: Missing output value`,
			};
		}

		// Validate output type matches item type
		if (itemType === 'boolean' && typeof outputValue !== 'boolean') {
			return {
				ok: false,
				error: `Rule ${i + 1}: Output value must be boolean (got ${typeof outputValue})`,
			};
		}

		if (itemType === 'string' && typeof outputValue !== 'string') {
			return {
				ok: false,
				error: `Rule ${i + 1}: Output value must be string (got ${typeof outputValue})`,
			};
		}

		// Empty or "true" condition = default/fallback rule
		if (!conditionExpr || conditionExpr === 'true' || conditionExpr === '1') {
			hasDefaultRule = true;
			compiledRules.push({
				condition: null, // null = always match
				outputValue,
				isDefault: true,
			});
			continue;
		}

		// Compile condition expression
		try {
			const normalized = normalizeFormulaExpressionImpl(conditionExpr);

			if (normalized && normalized.length > adapter.MAX_FORMULA_LENGTH) {
				return {
					ok: false,
					error: `Rule ${i + 1}: Condition too long (>${adapter.MAX_FORMULA_LENGTH} chars)`,
				};
			}

			const ast = parseExpression(normalized);
			adapter.analyzeAst(ast); // Validate depth/size

			compiledRules.push({
				condition: ast,
				normalizedExpr: normalized,
				outputValue,
				isDefault: false,
			});
		} catch (e) {
			return {
				ok: false,
				error: `Rule ${i + 1}: Invalid condition - ${e && e.message ? e.message : e}`,
			};
		}
	}

	// Determine default value (if no default rule exists)
	const defaultValue = hasDefaultRule ? null : itemType === 'boolean' ? false : '';

	return {
		ok: true,
		compiledRules,
		defaultValue,
	};
}

/**
 * Evaluate state machine rules and return the output value.
 * Rules are checked top-to-bottom; first matching rule wins.
 *
 * @param {any} adapter - The adapter instance
 * @param {any} item - The item configuration
 * @param {Map} snapshot - Snapshot of current state values (or null for cache)
 * @param {Array} compiledRules - Compiled rules from compileStateMachine
 * @param {any} defaultValue - Default value if no rule matches
 * @returns {any} Output value (string or boolean)
 */
function evaluateStateMachine(adapter, item, snapshot, compiledRules, defaultValue) {
	const itemType = item && item.type ? String(item.type) : 'string';

	// Build variables from inputs (same as formula mode)
	const inputs = Array.isArray(item.inputs) ? item.inputs : [];
	const vars = Object.create(null);

	for (const inp of inputs) {
		if (!inp || typeof inp !== 'object') {
			continue;
		}

		const keyRaw = inp.key ? String(inp.key).trim() : '';
		const key = keyRaw.replace(/[^a-zA-Z0-9_]/g, '_');

		if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
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
			const extracted = adapter.getValueFromJsonPath(raw, inp && inp.jsonPath, `stateMachine|${id}|${key}`);
			if (typeof extracted === 'string') {
				const n = Number(extracted);
				value = Number.isFinite(n) ? n : extracted;
			} else {
				value = extracted;
			}
		} else {
			// Only convert to number if the value is actually numeric
			if (typeof raw === 'string') {
				const n = Number(raw);
				value = Number.isFinite(n) ? n : raw;
			} else {
				value = adapter.safeNum(raw);
			}
		}

		// Per-input noNegative
		if (typeof value === 'number' && inp && inp.noNegative && value < 0) {
			value = 0;
		}

		vars[key] = value;
	}

	// Evaluate rules in order
	for (const rule of compiledRules) {
		// Default rule always matches
		if (rule.isDefault || rule.condition === null) {
			return rule.outputValue;
		}

		// Evaluate condition
		try {
			const result = adapter.evalFormulaAst(rule.condition, vars);

			// Truthy check
			if (result) {
				return rule.outputValue;
			}
		} catch (e) {
			// Log error but continue to next rule
			adapter.log.warn(
				`State machine rule evaluation failed for item '${item && item.targetId ? item.targetId : 'unknown'}': ${e && e.message ? e.message : e}`,
			);
		}
	}

	// No rule matched - return default value
	return defaultValue !== null ? defaultValue : itemType === 'boolean' ? false : '';
}

module.exports = {
	extractSourceIdsFromRules,
	compileStateMachine,
	evaluateStateMachine,
};
