'use strict';

// Builds a snapshot map for one tick, optionally refreshing input states first.

const { getDesiredSourceIdsForItems } = require('./subscriptions');

function getUseSnapshotReads(adapter) {
	return !!(adapter.config && adapter.config.snapshotInputs);
}

function getSnapshotDelayMs(adapter) {
	const raw = adapter.config && adapter.config.snapshotDelayMs !== undefined ? adapter.config.snapshotDelayMs : 0;
	const ms = Number(raw);
	return Number.isFinite(ms) && ms >= 0 && ms <= 5000 ? Math.round(ms) : 0;
}

async function buildSnapshotForTick(adapter, items) {
	const sourceIds = getDesiredSourceIdsForItems(adapter, items);

	if (getUseSnapshotReads(adapter)) {
		const delay = getSnapshotDelayMs(adapter);
		if (delay) {
			await new Promise(resolve => setTimeout(resolve, delay));
		}
		await Promise.all(
			Array.from(sourceIds).map(async id => {
				try {
					const st = await adapter.getForeignStateAsync(id);
					if (st) {
						adapter.cache.set(id, st.val);
						adapter.cacheTs.set(id, typeof st.ts === 'number' ? st.ts : Date.now());
					}
				} catch {
					// ignore per-id read errors
				}
			})
		);
	}

	/** @type {Map<string, any>} */
	const snapshot = new Map();
	for (const id of sourceIds) {
		snapshot.set(id, adapter.cache.get(id));
	}
	return snapshot;
}

module.exports = { buildSnapshotForTick };
