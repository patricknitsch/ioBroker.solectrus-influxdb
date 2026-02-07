'use strict';

// Discovers foreign state ids referenced by an item (inputs + s()/v()/jp() in formulas).
// This is used to decide which ids to subscribe to / include in snapshot reads.

const { getItemDisplayId } = require('./itemIds');

function collectSourceStatesFromItem(adapter, item) {
	const ids = [];
	if (!item || typeof item !== 'object') return ids;

	if ((item.mode || 'formula') === 'source') {
		if (item.sourceState) ids.push(String(item.sourceState));
		return ids;
	}

	if (Array.isArray(item.inputs)) {
		for (const inp of item.inputs) {
			if (inp && inp.sourceState) ids.push(String(inp.sourceState));
		}
	}

	// Also allow s("...") / v("...") / jp("...", "...") in formula;
	// discover these ids so snapshot/subscriptions can include them.
	const expr = item.formula ? String(item.formula) : '';
	if (!expr) return ids;

	const max = adapter.MAX_DISCOVERED_STATE_IDS_PER_ITEM || 250;
	let added = 0;
	const re = /\b(?:s|v)\(\s*(['"])([^'"\n\r]+)\1\s*\)/g;
	const reJp = /\bjp\(\s*(['"])([^'"\n\r]+)\1\s*,/g;
	let m;

	while ((m = re.exec(expr)) !== null) {
		const sid = (m[2] || '').trim();
		if (!sid) continue;
		ids.push(sid);
		added++;
		if (added >= max) {
			const itemId = getItemDisplayId(item) || (item && item.name ? String(item.name) : 'item');
			adapter.warnOnce(
				`discover_ids_limit|${itemId}`,
				`Formula contains many s()/v() state reads; limiting discovered ids to ${max} for '${itemId}'`
			);
			return ids;
		}
	}

	while ((m = reJp.exec(expr)) !== null) {
		const sid = (m[2] || '').trim();
		if (!sid) continue;
		ids.push(sid);
		added++;
		if (added >= max) {
			const itemId = getItemDisplayId(item) || (item && item.name ? String(item.name) : 'item');
			adapter.warnOnce(
				`discover_ids_limit|${itemId}`,
				`Formula contains many s()/v()/jp() state reads; limiting discovered ids to ${max} for '${itemId}'`
			);
			return ids;
		}
	}

	return ids;
}

module.exports = { collectSourceStatesFromItem };
