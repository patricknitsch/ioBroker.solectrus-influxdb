/* eslint-disable jsdoc/require-param */
'use strict';

const F = require('./functions');
const { extractPath } = require('./jsonpath');

/**
 * Very small whitelist to avoid arbitrary JS in formula.
 * Allows: numbers, whitespace, operators, parentheses, commas, dots, identifiers, underscores.
 */
function isFormulaSafe(expr) {
	return /^[0-9a-zA-Z_\s+\-*/%().,<>=!&|?:,]+$/.test(expr);
}

function toNumberOrNull(v) {
	if (v === null || v === undefined) {
		return null;
	}
	if (typeof v === 'number') {
		return Number.isFinite(v) ? v : null;
	}
	if (typeof v === 'boolean') {
		return v ? 1 : 0;
	}
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

async function readStateValue(adapter, id, snapshot, jsonPath) {
	const st = snapshot ? snapshot[id] : await adapter.getForeignStateAsync(id);
	if (!st) {
		return null;
	}
	const val = st.val;

	if (jsonPath) {
		return extractPath(val, jsonPath);
	}
	return val;
}

/**
 * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
 * @param {any} item
 * @param {Record<string, any> | null} snapshot
 */
async function evaluateItem(adapter, item, snapshot) {
	// direct source mode
	if (item.source && item.source.trim()) {
		const v = await readStateValue(adapter, item.source.trim(), snapshot, item.jsonPath);
		return toNumberOrNull(v);
	}

	// formula mode
	const expr = String(item.formula || '').trim();
	if (!expr) {
		return null;
	}
	if (!isFormulaSafe(expr)) {
		throw new Error('Formula contains forbidden characters');
	}

	// build vars from sourceStates
	const vars = {};
	for (const [key, stateId] of Object.entries(item.sourceStates || {})) {
		const k = String(key).trim();
		const id = String(stateId).trim();
		if (!k || !id) {
			continue;
		}
		const v = await readStateValue(adapter, id, snapshot, '');
		vars[k] = toNumberOrNull(v);
	}

	// Make scope
	const scopeKeys = [...Object.keys(F), ...Object.keys(vars)];
	const scopeVals = [...Object.values(F), ...Object.values(vars)];

	// eslint-disable-next-line no-new-func
	const fn = new Function(...scopeKeys, `"use strict"; return (${expr});`);
	const res = fn(...scopeVals);

	return toNumberOrNull(res);
}

module.exports = { evaluateItem };
