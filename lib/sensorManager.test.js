'use strict';

/* global describe, it */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { expect } = require('chai');

const { processJsonSensorData } = require('./sensorManager');

describe('processJsonSensorData', () => {
	it('does not buffer points for internal JSON sensors', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solectrus-json-internal-'));
		let flushScheduled = false;
		const setStates = [];
		const adapter = {
			jsonSourceMap: {
				'foreign.state': [
					{
						sensorName: 'INTERNAL_JSON',
						internal: true,
						tsField: 't',
						valField: 'y',
						measurement: 'forecast',
						field: 'power',
						influxType: 'int',
					},
				],
			},
			buffer: [],
			bufferFile: path.join(tmpDir, 'buffer.json'),
			maxBufferSize: 100,
			isFlushing: false,
			log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
			setState: (...args) => setStates.push(args),
			scheduleNextFlush: () => {
				flushScheduled = true;
			},
		};

		processJsonSensorData(adapter, 'foreign.state', JSON.stringify([{ t: 1710000000000, y: 1234 }]));

		expect(adapter.buffer).to.deep.equal([]);
		expect(flushScheduled).to.equal(false);
		expect(setStates).to.deep.equal([]);
	});

	it('writes the pvnode Plus variability band (y_min / y_max) in auto mode', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solectrus-json-auto-'));
		const adapter = {
			jsonSourceMap: {
				'pvforecast.0.summary.JSONData': [
					{ sensorName: 'INVERTER_POWER_FORECAST', internal: false, autoDetect: true, tsField: 't' },
				],
			},
			buffer: [],
			bufferFile: path.join(tmpDir, 'buffer.json'),
			maxBufferSize: 100,
			isFlushing: false,
			config: {},
			log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
			setState: () => {},
			scheduleNextFlush: () => {},
		};

		processJsonSensorData(
			adapter,
			'pvforecast.0.summary.JSONData',
			JSON.stringify([{ t: 1710000000000, y: 4000, y_min: 2500, y_max: 5200 }]),
		);

		const points = adapter.buffer.map(p => `${p.measurement}:${p.field}=${p.value}`);
		expect(points).to.have.members([
			'inverter_forecast:power=4000',
			'inverter_forecast:power_min=2500',
			'inverter_forecast:power_max=5200',
		]);
	});
});
