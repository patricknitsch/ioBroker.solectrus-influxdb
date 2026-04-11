'use strict';

const MAX_DELAY_MS = 2_147_483_647; // Node.js timer limit

const DEFAULT_MAX_VALUE = 0; // 0 = disabled by default

const JSON_PRESETS = {
	forecast: { tsField: 't', valField: 'y', measurement: 'inverter_forecast', field: 'power', influxType: 'int' },
	clearsky: {
		tsField: 't',
		valField: 'clearsky',
		measurement: 'inverter_forecast_clearsky',
		field: 'power',
		influxType: 'int',
	},
	temperature: {
		tsField: 't',
		valField: 'temp',
		measurement: 'outdoor_forecast',
		field: 'temperature',
		influxType: 'float',
	},
};

module.exports = { MAX_DELAY_MS, DEFAULT_MAX_VALUE, JSON_PRESETS };
