'use strict';

/* global describe, it */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');

const { collectPoints, writeSensorChange } = require('./collectFlush');

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

describe('write on change', () => {
	function makeAdapter() {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solectrus-update-'));
		const timers = [];
		return {
			config: {
				sensors: [
					{
						enabled: true,
						SensorName: 'CAR_ODOMETER_1',
						type: 'float',
						measurement: 'car',
						field: 'odometer',
						writeOnChange: true,
						aliveTimeoutMinutes: 0,
					},
				],
				notifyOnSensorTimeout: false,
				notifyOnMaxValueExceeded: false,
				notifyRepeatMinutes: 60,
			},
			cache: { 'sensors.car_odometer_1': 12345 },
			buffer: [],
			bufferFile: path.join(tmpDir, 'buffer.json'),
			lastUpdateTs: new Map(),
			lastWrittenTs: new Map(),
			aliveWarnedAt: new Map(),
			aliveNotifyAt: new Map(),
			maxValueWarnedAt: new Map(),
			lastValidValue: new Map(),
			negativeValueWarned: new Set(),
			log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
			setState: () => {},
			setTimeout: (fn, ms) => {
				timers.push(ms);
				return { ms };
			},
			clearTimeout: () => {},
			timers,
			maxBufferSize: 100,
			isFlushing: true,
		};
	}

	it('is not written by the collect loop', async () => {
		const adapter = makeAdapter();

		await collectPoints(adapter);

		expect(adapter.buffer).to.deep.equal([]);
	});

	it('writes each change once, with the time of the change', () => {
		const adapter = makeAdapter();
		const ts = Date.parse('2026-10-10T08:00:00Z');

		expect(writeSensorChange(adapter, 'sensors.car_odometer_1', { val: 12345.6, lc: ts, ts })).to.equal(true);
		// The car is polled again while it is parked: same value, new ts, same lc
		expect(
			writeSensorChange(adapter, 'sensors.car_odometer_1', { val: 12345.6, lc: ts, ts: ts + 900_000 }),
		).to.equal(false);
		expect(
			writeSensorChange(adapter, 'sensors.car_odometer_1', { val: 12399, lc: ts + 60_000, ts: ts + 1_800_000 }),
		).to.equal(true);

		expect(adapter.buffer).to.deep.equal([
			{ id: 'CAR_ODOMETER_1', measurement: 'car', field: 'odometer', type: 'float', value: 12345.6, ts },
			{
				id: 'CAR_ODOMETER_1',
				measurement: 'car',
				field: 'odometer',
				type: 'float',
				value: 12399,
				ts: ts + 60_000,
			},
		]);
	});

	it('ignores sensors without the option', () => {
		const adapter = makeAdapter();
		adapter.config.sensors[0].writeOnChange = false;

		expect(writeSensorChange(adapter, 'sensors.car_odometer_1', { val: 1, ts: Date.now() })).to.equal(false);
		expect(adapter.buffer).to.deep.equal([]);
	});
});
