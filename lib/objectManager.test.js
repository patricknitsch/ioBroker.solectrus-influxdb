'use strict';

/* global describe, it */

const { expect } = require('chai');

const { ensureDefaultSensorsAndTitles } = require('./objectManager');

describe('ensureDefaultSensorsAndTitles', () => {
	it('migrates legacy sensor groups and status titles', async () => {
		const obj = {
			native: {
				sensors: [
					{ enabled: true, internal: true, SensorName: 'BATTERY_SOC' },
					{ enabled: true, SensorName: 'MY_CUSTOM_SENSOR' },
					{ enabled: false, SensorName: 'LEGACY_UNGROUPED_SENSOR', group: '' },
					{ enabled: true, SensorName: 'HOUSE_POWER', group: 'Standard Solectrus Sensoren' },
					{ enabled: true, SensorName: 'ANOTHER_CUSTOM_SENSOR', group: 'Benutzerdefiniert' },
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
		expect(written.native.sensors).to.deep.equal([
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
		]);
		expect(adapter.config.sensors).to.equal(written.native.sensors);
	});
});
