/* eslint-disable jsdoc/require-jsdoc */
'use strict';

function calcStateId(cfg, item) {
	// under adapter namespace: calc.<targetId>
	const safe = String(item.targetId)
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '_');
	return `calc.${safe}`;
}

/**
 * Create objects for calc states
 *
 * @param adapter
 * @param cfg
 */
async function ensureCalcObjects(adapter, cfg) {
	await adapter.setObjectNotExistsAsync('calc', {
		type: 'channel',
		common: { name: 'Calculations' },
		native: {},
	});

	for (const item of cfg.items) {
		const id = calcStateId(cfg, item);
		await adapter.setObjectNotExistsAsync(id, {
			type: 'state',
			common: {
				name: item.targetId,
				type: 'number',
				role: 'value',
				read: true,
				write: false,
			},
			native: {
				measurement: item.measurement,
				field: item.field,
			},
		});
	}
}

async function writeCalcState(adapter, cfg, item, value, tickMs) {
	const id = calcStateId(cfg, item);
	await adapter.setStateAsync(id, { val: value, ack: true, ts: tickMs });
}

module.exports = { ensureCalcObjects, writeCalcState };
