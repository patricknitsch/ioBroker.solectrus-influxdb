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
