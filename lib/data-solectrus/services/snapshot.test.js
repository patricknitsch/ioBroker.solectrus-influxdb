/* global describe, it */
'use strict';

const { expect } = require('chai');
const { buildSnapshotForTick } = require('./snapshot');

describe('snapshot service', () => {
	it('uses adapter.setTimeout for snapshot delay', async () => {
		const timeoutCalls = [];
		const adapter = {
			config: { snapshotInputs: true, snapshotDelayMs: 25 },
			compiledItems: new Map([['out1', { sourceIds: ['source.1'] }]]),
			cache: new Map(),
			cacheTs: new Map(),
			setTimeout: (resolve, ms) => {
				timeoutCalls.push(ms);
				resolve();
			},
			getForeignStateAsync: async () => ({ val: 123, ts: 1000 }),
			MAX_TOTAL_SOURCE_IDS: 5000,
			warnOnce: () => {},
		};

		const items = [{ enabled: true, targetId: 'out1' }];
		const snapshot = await buildSnapshotForTick(adapter, items);

		expect(timeoutCalls).to.deep.equal([25]);
		expect(snapshot.get('source.1')).to.equal(123);
	});
});
