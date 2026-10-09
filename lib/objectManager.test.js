'use strict';

/* global describe, it */

const { expect } = require('chai');

const { ensureDefaultSensorsAndTitles, addMissingDefaultSensors } = require('./objectManager');
const ioPack = require('../io-package.json');

const ALL_DEFAULT_NAMES = ioPack.native.sensors.map(s => s.SensorName);

describe('ensureDefaultSensorsAndTitles', () => {
	it('migrates legacy sensor groups and status titles', async () => {
		const obj = {
			native: {
				_knownDefaultSensors: ALL_DEFAULT_NAMES,
				sensors: [
					{ enabled: true, internal: true, SensorName: 'BATTERY_SOC' },
					{ enabled: true, SensorName: 'MY_CUSTOM_SENSOR' },
					{ enabled: false, SensorName: 'LEGACY_UNGROUPED_SENSOR', group: '' },
					{ enabled: true, SensorName: 'HOUSE_POWER', group: 'Standard Solectrus Sensoren' },
					{ enabled: true, SensorName: 'ANOTHER_CUSTOM_SENSOR', group: 'Benutzerdefiniert' },
					{ enabled: true, SensorName: 'CAR_MILEAGE_2' },
					{ enabled: true, SensorName: 'CAR_RANGE_6' },
				],
			},
		};
		let written = null;
		const adapter = {
			namespace: 'solectrus-influxdb.0',
			config: {},
			log: { warn: () => {} },
			getForeignObjectAsync: async () => obj,
			setForeignObject: async (_id, nextObj) => {
				written = nextObj;
			},
		};

		await ensureDefaultSensorsAndTitles(adapter);

		expect(written).to.not.equal(null);
		if (!written) {
			throw new Error('setForeignObject was not called');
		}
		const result = /** @type {{ native: { sensors: unknown[] } }} */ (written);
		expect(result.native.sensors).to.deep.equal([
			{
				enabled: true,
				internal: true,
				SensorName: 'BATTERY_SOC',
				group: 'Default SOLECTRUS sensors',
				_title: '🟡 BATTERY_SOC',
			},
			{
				enabled: true,
				SensorName: 'MY_CUSTOM_SENSOR',
				internal: false,
				group: 'Custom sensors',
				_title: '🟢 MY_CUSTOM_SENSOR',
			},
			{
				enabled: false,
				SensorName: 'LEGACY_UNGROUPED_SENSOR',
				group: '',
				internal: false,
				_title: '⚪ LEGACY_UNGROUPED_SENSOR',
			},
			{
				enabled: true,
				SensorName: 'HOUSE_POWER',
				group: 'Default SOLECTRUS sensors',
				internal: false,
				_title: '🟢 HOUSE_POWER',
			},
			{
				enabled: true,
				SensorName: 'ANOTHER_CUSTOM_SENSOR',
				group: 'Custom sensors',
				internal: false,
				_title: '🟢 ANOTHER_CUSTOM_SENSOR',
			},
			{
				enabled: true,
				SensorName: 'CAR_MILEAGE_2',
				internal: false,
				group: 'Default SOLECTRUS sensors',
				_title: '🟢 CAR_MILEAGE_2',
			},
			{
				enabled: true,
				SensorName: 'CAR_RANGE_6',
				internal: false,
				group: 'Custom sensors',
				_title: '🟢 CAR_RANGE_6',
			},
		]);
		expect(adapter.config.sensors).to.equal(result.native.sensors);
	});
});

describe('addMissingDefaultSensors', () => {
	const defaults = [
		{ enabled: false, SensorName: 'HOUSE_POWER', measurement: 'house', field: 'power' },
		{ enabled: false, SensorName: 'CAR_BATTERY_SOC_1', measurement: 'car', field: 'battery_soc' },
		{ enabled: false, SensorName: 'CAR_MILEAGE_1', measurement: 'car', field: 'mileage' },
	];

	it('adds new defaults disabled to an instance from before the tracking', () => {
		const native = {
			sensors: [{ enabled: true, SensorName: 'CAR_BATTERY_SOC', measurement: 'car', field: 'battery_soc' }],
		};

		const added = addMissingDefaultSensors(native, defaults);

		// HOUSE_POWER is in the baseline (the user deleted it), CAR_BATTERY_SOC_1 writes the
		// same field as CAR_BATTERY_SOC, so only CAR_MILEAGE_1 is new.
		expect(added).to.deep.equal(['CAR_MILEAGE_1']);
		expect(native.sensors[1]).to.deep.equal({
			enabled: false,
			SensorName: 'CAR_MILEAGE_1',
			measurement: 'car',
			field: 'mileage',
		});
		expect(native._knownDefaultSensors).to.include.members(['HOUSE_POWER', 'CAR_BATTERY_SOC_1', 'CAR_MILEAGE_1']);
	});

	it('does not add a known default again after the user deleted it', () => {
		const native = { sensors: [] };
		addMissingDefaultSensors(native, defaults);
		native.sensors = [];

		expect(addMissingDefaultSensors(native, defaults)).to.deep.equal([]);
		expect(native.sensors).to.deep.equal([]);
	});

	it('adds nothing on a fresh install, which got all defaults', () => {
		const native = { sensors: JSON.parse(JSON.stringify(ioPack.native.sensors)) };

		expect(addMissingDefaultSensors(native)).to.deep.equal([]);
		expect(native.sensors).to.have.length(ioPack.native.sensors.length);
		expect(native._knownDefaultSensors).to.include.members(ALL_DEFAULT_NAMES);
	});

	it('adds the new car sensors to an instance of release 2.0.1', () => {
		const native = {
			sensors: [{ enabled: false, SensorName: 'CAR_BATTERY_SOC', measurement: 'car', field: 'battery_soc' }],
		};

		expect(addMissingDefaultSensors(native)).to.deep.equal([
			'CAR_MILEAGE_1',
			'CAR_RANGE_1',
			'CAR_CONNECTED_1',
			'CAR_LATITUDE_1',
			'CAR_LONGITUDE_1',
		]);
	});
});
