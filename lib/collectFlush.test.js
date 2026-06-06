'use strict';

/* global describe, it */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');

const { collectPoints } = require('./collectFlush');

describe('collectPoints', () => {
	it('does not buffer internal sensors', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solectrus-internal-'));
		const setStates = [];
		const adapter = {
			config: {
				sensors: [
					{
						enabled: true,
						internal: true,
						SensorName: 'INTERNAL_SENSOR',
						type: 'int',
						measurement: 'internal',
						field: 'value',
						aliveTimeoutMinutes: 0,
					},
				],
				notifyOnSensorTimeout: false,
				notifyOnMaxValueExceeded: false,
				notifyRepeatMinutes: 60,
			},
			cache: { 'sensors.internal_sensor': 42 },
			buffer: [],
			bufferFile: path.join(tmpDir, 'buffer.json'),
			lastUpdateTs: new Map(),
			aliveWarnedAt: new Map(),
			aliveNotifyAt: new Map(),
			maxValueWarnedAt: new Map(),
			lastValidValue: new Map(),
			negativeValueWarned: new Set(),
			log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
			setState: (...args) => setStates.push(args),
			scheduleNextFlush: () => {
				throw new Error('scheduleNextFlush should not be called');
			},
			maxBufferSize: 100,
			isFlushing: false,
		};

		await collectPoints(adapter);

		expect(adapter.buffer).to.deep.equal([]);
		expect(setStates).to.deep.equal([
			['info.buffer.size', 0, true],
			['info.buffer.oldest', '', true],
		]);
	});
});
