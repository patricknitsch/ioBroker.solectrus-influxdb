'use strict';

/**
 * Minimal "path" extractor:
 * - If val is JSON string -> parse
 * - Supports dot paths: a.b.c
 */
function extractPath(val, path) {
	if (!path) {
		return val;
	}

	let obj = val;

	if (typeof obj === 'string') {
		const s = obj.trim();
		if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
			try {
				obj = JSON.parse(s);
			} catch {
				return null;
			}
		} else {
			return null;
		}
	}

	if (obj === null || obj === undefined) {
		return null;
	}
	if (typeof obj !== 'object') {
		return null;
	}

	const parts = String(path)
		.split('.')
		.map(p => p.trim())
		.filter(Boolean);
	let cur = obj;

	for (const p of parts) {
		if (cur && typeof cur === 'object' && p in cur) {
			cur = cur[p];
		} else {
			return null;
		}
	}

	return cur;
}

module.exports = { extractPath };
