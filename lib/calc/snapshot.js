/* eslint-disable jsdoc/require-param */
'use strict';

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Reads all input states once.
 */
async function readSnapshot(adapter, cfg, delayMs) {
	if (delayMs > 0) {
		await sleep(delayMs);
	}

	const ids = new Set();

	for (const item of cfg.items) {
		if (!item.enabled) {
			continue;
		}

		// formula inputs
		if (item.sourceStates && typeof item.sourceStates === 'object') {
			for (const id of Object.values(item.sourceStates)) {
				if (id) {
					ids.add(String(id));
				}
			}
		}

		// optional direct source
		if (item.source) {
			ids.add(String(item.source));
		}
	}

	const snapshot = {};
	await Promise.all(
		[...ids].map(async id => {
			try {
				const st = await adapter.getForeignStateAsync(id);
				snapshot[id] = st || null;
			} catch {
				snapshot[id] = null;
			}
		}),
	);

	return snapshot;
}

module.exports = { readSnapshot };
