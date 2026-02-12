/* eslint-disable jsdoc/require-param-description */
/* eslint-disable jsdoc/require-jsdoc */
'use strict';

/**
 * Minimal JSONPath subset evaluator for typical IoT payloads.
 * Supported examples:
 * - $.apower
 * - $.aenergy.by_minute[2]
 * - $['temperature']['tC']
 *
 * Not supported: filters, wildcards, unions, recursive descent, functions.
 *
 * @param obj
 * @param path
 */
function applyJsonPath(obj, path) {
	if (!path) {
		return undefined;
	}
	let p = String(path).trim();
	if (!p) {
		return undefined;
	}

	// Accept both "$.x" and ".x" as a convenience.
	if (p.startsWith('.')) {
		p = `$${p}`;
	}
	if (!p.startsWith('$')) {
		return undefined;
	}

	let cur = obj;
	let i = 1; // skip '$'
	const len = p.length;
	const isDangerousKey = k => k === '__proto__' || k === 'prototype' || k === 'constructor';
	while (i < len) {
		const ch = p[i];
		if (ch === '.') {
			i++;
			let start = i;
			while (i < len && /[A-Za-z0-9_]/.test(p[i])) {
				i++;
			}
			const key = p.slice(start, i);
			if (!key) {
				return undefined;
			}
			if (isDangerousKey(key)) {
				return undefined;
			}
			if (cur === null || cur === undefined) {
				return undefined;
			}
			cur = cur[key];
			continue;
		}
		if (ch === '[') {
			i++;
			while (i < len && /\s/.test(p[i])) {
				i++;
			}
			if (i >= len) {
				return undefined;
			}
			const quote = p[i] === '"' || p[i] === "'" ? p[i] : null;
			if (quote) {
				i++;
				let str = '';
				while (i < len) {
					const c = p[i];
					if (c === '\\') {
						if (i + 1 < len) {
							str += p[i + 1];
							i += 2;
							continue;
						}
						return undefined;
					}
					if (c === quote) {
						i++;
						break;
					}
					str += c;
					i++;
				}
				while (i < len && /\s/.test(p[i])) {
					i++;
				}
				if (p[i] !== ']') {
					return undefined;
				}
				i++;
				if (isDangerousKey(str)) {
					return undefined;
				}
				if (cur === null || cur === undefined) {
					return undefined;
				}
				cur = cur[str];
				continue;
			}

			// array index
			let start = i;
			while (i < len && /[0-9]/.test(p[i])) {
				i++;
			}
			const numStr = p.slice(start, i);
			while (i < len && /\s/.test(p[i])) {
				i++;
			}
			if (p[i] !== ']') {
				return undefined;
			}
			i++;
			const idx = Number(numStr);
			if (!Number.isInteger(idx)) {
				return undefined;
			}
			if (!Array.isArray(cur)) {
				return undefined;
			}
			cur = cur[idx];
			continue;
		}

		// Unknown token
		return undefined;
	}
	return cur;
}

function getNumericFromJsonPath(rawValue, jsonPath, opts) {
	const options = opts || {};
	const safeNum =
		typeof options.safeNum === 'function'
			? options.safeNum
			: v => {
					const n = Number(v);
					return Number.isFinite(n) ? n : 0;
				};
	const warnOnce = typeof options.warnOnce === 'function' ? options.warnOnce : () => {};
	const debugOnce = typeof options.debugOnce === 'function' ? options.debugOnce : () => {};
	const warnKeyPrefix = options.warnKeyPrefix || '';

	const jp = jsonPath !== undefined && jsonPath !== null ? String(jsonPath).trim() : '';
	if (!jp) {
		return safeNum(rawValue);
	}

	// Be forgiving: if the value is already numeric-ish, just use it.
	// This allows mixed setups where a state sometimes is numeric and sometimes JSON-string.
	if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
		debugOnce(
			`jsonpath_skipped_numeric|${warnKeyPrefix || ''}`,
			`JSONPath '${jp}' skipped because source value is already ${typeof rawValue} (${warnKeyPrefix || 'no-prefix'})`,
		);
		return safeNum(rawValue);
	}

	let obj = null;
	if (rawValue && typeof rawValue === 'object') {
		obj = rawValue;
	} else if (typeof rawValue === 'string') {
		const s = rawValue.trim();
		if (!s) {
			warnOnce(`${warnKeyPrefix}|empty`, `JSONPath configured but source value is empty (${jp})`);
			return 0;
		}
		try {
			obj = JSON.parse(s);
		} catch (e) {
			warnOnce(
				`${warnKeyPrefix}|parse`,
				`Cannot parse JSON for JSONPath ${jp}: ${e && e.message ? e.message : e}`,
			);
			return 0;
		}
	} else {
		warnOnce(
			`${warnKeyPrefix}|type`,
			`JSONPath configured but source value is not JSON (${typeof rawValue}) (${jp})`,
		);
		return 0;
	}

	const extracted = applyJsonPath(obj, jp);
	if (extracted === undefined) {
		warnOnce(`${warnKeyPrefix}|path`, `JSONPath did not match any value: ${jp}`);
		return 0;
	}
	return safeNum(extracted);
}

function getValueFromJsonPath(rawValue, jsonPath, opts) {
	const options = opts || {};
	const warnOnce = typeof options.warnOnce === 'function' ? options.warnOnce : () => {};
	const warnKeyPrefix = options.warnKeyPrefix || '';

	const jp = jsonPath !== undefined && jsonPath !== null ? String(jsonPath).trim() : '';
	if (!jp) {
		return rawValue;
	}

	let obj = null;
	if (rawValue && typeof rawValue === 'object') {
		obj = rawValue;
	} else if (typeof rawValue === 'string') {
		const s = rawValue.trim();
		if (!s) {
			warnOnce(`${warnKeyPrefix}|empty`, `JSONPath configured but source value is empty (${jp})`);
			return undefined;
		}
		try {
			obj = JSON.parse(s);
		} catch (e) {
			warnOnce(
				`${warnKeyPrefix}|parse`,
				`Cannot parse JSON for JSONPath ${jp}: ${e && e.message ? e.message : e}`,
			);
			return undefined;
		}
	} else {
		warnOnce(
			`${warnKeyPrefix}|type`,
			`JSONPath configured but source value is not JSON (${typeof rawValue}) (${jp})`,
		);
		return undefined;
	}

	const extracted = applyJsonPath(obj, jp);
	if (extracted === undefined) {
		warnOnce(`${warnKeyPrefix}|path`, `JSONPath did not match any value: ${jp}`);
		return undefined;
	}
	if (extracted === null) {
		return null;
	}
	const t = typeof extracted;
	if (t === 'string' || t === 'number' || t === 'boolean') {
		return extracted;
	}
	if (extracted instanceof Date && typeof extracted.toISOString === 'function') {
		return extracted.toISOString();
	}
	// Keep formulas deterministic: do not expose objects/arrays.
	return undefined;
}

module.exports = {
	applyJsonPath,
	getNumericFromJsonPath,
	getValueFromJsonPath,
};
