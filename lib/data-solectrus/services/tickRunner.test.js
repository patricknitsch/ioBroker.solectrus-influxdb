/* global describe, it */
'use strict';

const { expect } = require('chai');
const { scheduleNextTick } = require('./tickRunner');

describe('tickRunner service', () => {
	it('uses adapter timeout wrappers when scheduling ticks', () => {
		const cleared = [];
		const timeoutCalls = [];
		const oldTimer = { old: true };

		const adapter = {
			isUnloading: false,
			config: { pollIntervalSeconds: 5 },
			tickTimer: oldTimer,
			clearTimeout: timer => {
				cleared.push(timer);
			},
			setTimeout: (fn, delay) => {
				timeoutCalls.push(delay);
				return { new: true, fn };
			},
		};

		scheduleNextTick(adapter);

		expect(cleared).to.deep.equal([oldTimer]);
		expect(timeoutCalls).to.have.length(1);
		expect(timeoutCalls[0]).to.be.a('number');
		expect(timeoutCalls[0]).to.be.greaterThan(0);
		expect(timeoutCalls[0]).to.be.at.most(5000);
		expect(adapter.tickTimer).to.be.an('object');
	});
});

describe('tickRunner budget', () => {
	it('does not count slow snapshot reads against the evaluation budget', async () => {
		const { createDsProxy } = require('../../dsProxy');
		const { getItemsConfigSignature } = require('./itemManager');
		const { runTick } = require('./tickRunner');

		const items = [1, 2, 3].map(n => ({
			enabled: true,
			mode: 'source',
			targetId: `out${n}`,
			sourceState: `src.${n}`,
		}));
		const written = new Map();
		const warnings = [];
		const base = {
			namespace: 'solectrus-influxdb.0',
			// 0.05 s interval -> 40 ms budget, the reads below take 100 ms
			config: { dsItems: items, dsPollIntervalSeconds: 0.05, dsSnapshotInputs: true },
			log: { warn: m => warnings.push(m), debug: () => {}, info: () => {}, error: () => {} },
			setState: (id, val) => written.set(id, val),
			setTimeout: (fn, ms) => setTimeout(fn, ms),
			getForeignStateAsync: id =>
				new Promise(resolve =>
					setTimeout(() => resolve({ val: Number(id.split('.')[1]), ts: Date.now() }), 100),
				),
		};
		const ds = createDsProxy(base);
		ds.itemsConfigSignature = getItemsConfigSignature(ds, items);

		await runTick(ds);

		expect(warnings.filter(m => m.includes('budget'))).to.deep.equal([]);
		expect(written.get('ds.out1')).to.equal(1);
		expect(written.get('ds.out3')).to.equal(3);
		expect(written.get('ds.info.diagnostics.evalSkipped')).to.equal(0);
	});
});
