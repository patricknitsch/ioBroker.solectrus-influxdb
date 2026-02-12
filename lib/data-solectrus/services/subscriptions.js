'use strict';

// Computes which foreign ids should be subscribed/snapshotted based on enabled items.

const { getItemOutputId } = require('./itemIds');
const { collectSourceStatesFromItem } = require('./sourceDiscovery');

function getMaxTotalSourceIds(adapter) {
	const raw = Number(adapter.MAX_TOTAL_SOURCE_IDS);
	if (!Number.isFinite(raw) || raw <= 0) return 5000;
	return Math.min(50000, Math.round(raw));
}

function getDesiredSourceIdsForItems(adapter, items) {
	const enabledItems = Array.isArray(items)
		? items.filter(it => it && typeof it === 'object' && it.enabled)
		: [];

	const desired = new Set();
	for (const item of enabledItems) {
		const out = getItemOutputId(item);
		const compiled = out ? adapter.compiledItems.get(out) : null;
		if (compiled && compiled.sourceIds) {
			for (const id of compiled.sourceIds) {
				if (id) desired.add(String(id));
			}
		} else {
			for (const id of collectSourceStatesFromItem(adapter, item)) {
				if (id) desired.add(String(id));
			}
		}
	}

	const cap = getMaxTotalSourceIds(adapter);
	if (desired.size > cap) {
		const kept = new Set();
		let n = 0;
		for (const id of desired) {
			kept.add(id);
			n++;
			if (n >= cap) break;
		}
		adapter.warnOnce(
			`source_ids_cap|${cap}`,
			`Too many source state ids (${desired.size}); limiting subscriptions/snapshot to first ${cap}. Please reduce configured items/inputs.`
		);
		return kept;
	}
	return desired;
}

function syncSubscriptions(adapter, desiredIds) {
	const desired = desiredIds instanceof Set ? desiredIds : new Set();

	// Unsubscribe stale ids
	for (const id of Array.from(adapter.subscribedIds)) {
		if (!desired.has(id)) {
			try {
				adapter.unsubscribeForeignStates(id);
			} catch (e) {
				adapter.log.debug(`Cannot unsubscribe ${id}: ${e && e.message ? e.message : e}`);
			} finally {
				adapter.subscribedIds.delete(id);
			}
		}
	}

	// Subscribe missing ids
	for (const id of desired) {
		if (adapter.subscribedIds.has(id)) continue;
		try {
			adapter.subscribeForeignStates(id);
			adapter.subscribedIds.add(id);
		} catch (e) {
			adapter.log.warn(`Cannot subscribe ${id}: ${e && e.message ? e.message : e}`);
		}
	}
}

module.exports = {
	getDesiredSourceIdsForItems,
	syncSubscriptions,
};
