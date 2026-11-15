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
			['info.staleInputs', '{}', true],
			['info.staleSensors', '[]', true],
			['info.staleFormulaInputs', '{}', true],
			['info.buffer.size', 0, true],
			['info.buffer.oldest', '', true],
		]);
	});
});

describe('alive monitoring of Data-SOLECTRUS inputs', () => {
	function makeAdapter(inputTs, now) {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solectrus-ds-alive-'));
		const warnings = [];
		const setStates = [];
		return {
			namespace: 'solectrus-influxdb.0',
			config: {
				sensors: [
					{
						enabled: true,
						internal: true,
						SensorName: 'HOUSE_POWER',
						sourceState: 'solectrus-influxdb.0.ds.house',
						type: 'float',
						measurement: 'power',
						field: 'house',
						aliveTimeoutMinutes: 10,
					},
				],
				notifyOnSensorTimeout: false,
				notifyRepeatMinutes: 60,
			},
			cache: { 'sensors.house_power': 500 },
			buffer: [],
			bufferFile: path.join(tmpDir, 'buffer.json'),
			// The item output itself is updated on every tick
			lastUpdateTs: new Map([['sensors.house_power', now]]),
			aliveWarnedAt: new Map(),
			aliveNotifyAt: new Map(),
			maxValueWarnedAt: new Map(),
			lastValidValue: new Map(),
			negativeValueWarned: new Set(),
			dsProxy: {
				compiledItems: new Map([
					['house', { sourceIds: new Set(['meter.0.grid', 'solectrus-influxdb.0.ds.pv']) }],
					['pv', { sourceIds: new Set(['inverter.0.power', 'solectrus-influxdb.0.sensors.x']) }],
				]),
				cache: new Map([
					['meter.0.grid', 200],
					['inverter.0.power', 300],
				]),
				cacheTs: new Map([
					['meter.0.grid', now],
					['inverter.0.power', inputTs],
				]),
			},
			log: { debug: () => {}, warn: msg => warnings.push(msg), info: () => {}, error: () => {} },
			setState: (...args) => setStates.push(args),
			warnings,
			setStates,
			maxBufferSize: 100,
			isFlushing: false,
		};
	}

	it('warns when an input of the item (also of a nested item) is stale', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);

		await collectPoints(adapter);

		expect(adapter.warnings).to.have.length(1);
		expect(adapter.warnings[0]).to.contain('Sensor "HOUSE_POWER → inverter.0.power": no update since');
		expect(adapter.setStates).to.deep.include([
			'info.staleInputs',
			JSON.stringify({ HOUSE_POWER: [{ id: 'inverter.0.power', ts: now - 30 * 60_000 }] }),
			true,
		]);
		// A sensor with a stale input is listed as stale for the device manager
		expect(adapter.setStates).to.deep.include(['info.staleSensors', '["HOUSE_POWER"]', true]);
	});

	it('lists a sensor without update within its alive timeout as stale', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now, now);
		adapter.lastUpdateTs.set('sensors.house_power', now - 30 * 60_000);

		await collectPoints(adapter);

		expect(adapter.setStates).to.deep.include(['info.staleSensors', '["HOUSE_POWER"]', true]);
	});

	it('lists a sensor with the value 0 as stale after 60 minutes only', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now, now);
		adapter.cache['sensors.house_power'] = 0;
		adapter.lastUpdateTs.set('sensors.house_power', now - 30 * 60_000);

		await collectPoints(adapter);

		expect(adapter.setStates).to.deep.include(['info.staleSensors', '[]', true]);
	});

	it('does not warn for inputs with monitoring turned off', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		adapter.dsProxy.compiledItems.get('pv').item = {
			inputs: [{ key: 'pv', sourceState: 'inverter.0.power', noMonitoring: true }],
		};

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
		expect(adapter.setStates).to.deep.include(['info.staleInputs', '{}', true]);
	});

	it('does not follow a nested item with monitoring turned off', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		adapter.dsProxy.compiledItems.get('house').item = {
			inputs: [{ key: 'pv', sourceState: 'solectrus-influxdb.0.ds.pv', noMonitoring: true }],
		};

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
	});

	it('does not warn for the source of a source item with monitoring turned off', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		adapter.dsProxy.compiledItems.get('pv').item = {
			mode: 'source',
			sourceState: 'inverter.0.power',
			noMonitoring: true,
		};

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
	});

	it('monitors an internal item with its own alive timeout', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		// No sensor uses the item
		adapter.config.sensors = [];
		adapter.dsProxy.compiledItems.get('pv').item = { enabled: true, aliveTimeoutMinutes: 10 };

		await collectPoints(adapter);

		expect(adapter.warnings).to.have.length(1);
		expect(adapter.warnings[0]).to.contain('Formula "ds.pv → inverter.0.power": no update since');
		expect(adapter.setStates).to.deep.include([
			'info.staleFormulaInputs',
			JSON.stringify({ pv: [{ id: 'inverter.0.power', ts: now - 30 * 60_000 }] }),
			true,
		]);
	});

	it('checks an item not used by a sensor, even when a sensor checks the same input', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		// HOUSE_POWER uses ds.house (which uses ds.pv); a disabled sensor uses ds.pv
		adapter.config.sensors.push({
			enabled: false,
			SensorName: 'PV_POWER',
			sourceState: 'solectrus-influxdb.0.ds.pv',
			aliveTimeoutMinutes: 10,
		});
		adapter.dsProxy.compiledItems.get('pv').item = { enabled: true, aliveTimeoutMinutes: 10 };
		adapter.dsProxy.compiledItems.get('house').item = { enabled: true, aliveTimeoutMinutes: 10 };

		await collectPoints(adapter);

		// ds.house is checked by its sensor only; ds.pv is used by no enabled sensor and checks itself
		expect(adapter.warnings).to.have.length(2);
		expect(adapter.warnings[0]).to.contain('Sensor "HOUSE_POWER → inverter.0.power"');
		expect(adapter.warnings[1]).to.contain('Formula "ds.pv → inverter.0.power"');
		expect(adapter.setStates).to.deep.include([
			'info.staleFormulaInputs',
			JSON.stringify({
				pv: [{ id: 'inverter.0.power', ts: now - 30 * 60_000 }],
				house: [{ id: 'inverter.0.power', ts: now - 30 * 60_000 }],
			}),
			true,
		]);
	});

	it('does not check an item used by a sensor, even when the sensor has no timeout', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		adapter.config.sensors[0].aliveTimeoutMinutes = 0;
		adapter.dsProxy.compiledItems.get('house').item = { enabled: true, aliveTimeoutMinutes: 10 };

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
	});

	it('does not monitor an item without alive timeout', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now - 30 * 60_000, now);
		adapter.config.sensors = [];
		adapter.dsProxy.compiledItems.get('pv').item = { enabled: true, aliveTimeoutMinutes: 0 };

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
		expect(adapter.setStates).to.deep.include(['info.staleFormulaInputs', '{}', true]);
	});

	it('does not warn when all inputs are fresh', async () => {
		const now = Date.now();
		const adapter = makeAdapter(now, now);

		await collectPoints(adapter);

		expect(adapter.warnings).to.deep.equal([]);
		expect(adapter.setStates).to.deep.include(['info.staleInputs', '{}', true]);
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
