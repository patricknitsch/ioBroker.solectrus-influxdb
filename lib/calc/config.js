/* eslint-disable jsdoc/require-param */
'use strict';

function safeJsonParse(s, fallback) {
	try {
		return JSON.parse(s);
	} catch {
		return fallback;
	}
}

/**
 * Adapter config -> runtime config
 */
function getCalcConfig(nativeConfig) {
	const c = nativeConfig?.calc || {};

	const enabled = !!c.enabled;
	const intervalSec = Math.max(1, Number(c.interval) || 5);
	const snapshot = c.snapshot !== false;
	const snapshotDelayMs = Math.max(0, Number(c.snapshotDelayMs) || 0);
	const writeStates = c.writeStates !== false;

	const itemsRaw = safeJsonParse(c.itemsJson || '[]', []);
	const items = Array.isArray(itemsRaw) ? itemsRaw : [];

	// Normalize
	const normalized = items.map((it, idx) => {
		const sourceStates = it && typeof it.sourceStates === 'object' && it.sourceStates ? it.sourceStates : {};

		return {
			enabled: it?.enabled !== false,
			targetId: String(it?.targetId || `item_${idx}`).trim(),
			measurement: String(it?.measurement || '').trim(),
			field: String(it?.field || '').trim(),
			type:
				it?.type === 'int' || it?.type === 'float' || it?.type === 'bool' || it?.type === 'string'
					? it.type
					: 'float',

			// data-solectrus-like
			sourceStates,
			formula: it?.formula ? String(it.formula) : '',
			source: it?.source ? String(it.source) : '', // optional simple direct source
			jsonPath: it?.jsonPath ? String(it.jsonPath) : '',

			clampNegative: !!it?.clampNegative,
			min: it?.min === 0 || it?.min ? Number(it.min) : null,
			max: it?.max === 0 || it?.max ? Number(it.max) : null,
		};
	});

	return {
		enabled,
		intervalSec,
		snapshot,
		snapshotDelayMs,
		writeStates,
		items: normalized,
	};
}

module.exports = { getCalcConfig };
