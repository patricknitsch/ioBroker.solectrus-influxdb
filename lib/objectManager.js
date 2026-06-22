'use strict';

const DEFAULT_SENSOR_GROUP_KEY = 'Default SOLECTRUS sensors';
const CUSTOM_SENSOR_GROUP_KEY = 'Custom sensors';

// Named JSON forecast sensors and their specific presets (one measurement each)
const FORECAST_SENSOR_PRESETS = {
	INVERTER_POWER_FORECAST: 'forecast',
	INVERTER_POWER_FORECAST_CLEARSKY: 'clearsky',
	OUTDOOR_TEMP_FORECAST: 'temperature',
};

function isDefaultSensorName(name) {
	const sensorName = String(name || '').trim();
	return [
		/^INVERTER_POWER(?:_[1-5])?$/,
		/^GRID_(?:IMPORT_POWER|EXPORT_POWER|EXPORT_LIMIT)$/,
		/^CASE_TEMP$/,
		/^SYSTEM_STATUS(?:_OK)?$/,
		/^BATTERY_(?:SOC|CHARGING_POWER|DISCHARGING_POWER)$/,
		/^HOUSE_POWER$/,
		/^HEATPUMP_(?:POWER|HEATING_POWER|TANK_TEMP|TANK_TEMP_SETPOINT|STATUS)$/,
		/^CUSTOM_POWER_\d{2}$/,
		/^WALLBOX_(?:POWER|CONNECTED)$/,
		/^CAR_BATTERY_SOC$/,
		/^OUTDOOR_TEMP(?:_FORECAST)?$/,
		/^INVERTER_POWER_FORECAST(?:_CLEARSKY)?$/,
	].some(pattern => pattern.test(sensorName));
}

function hasExplicitSensorGroup(sensor) {
	return !!(
		sensor &&
		typeof sensor === 'object' &&
		Object.prototype.hasOwnProperty.call(sensor, 'group') &&
		sensor.group !== undefined &&
		sensor.group !== null
	);
}

function canonicalizeSensorGroupName(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) {
		return '';
	}
	if (
		trimmed === DEFAULT_SENSOR_GROUP_KEY ||
		trimmed === 'Standard Solectrus Sensoren' ||
		trimmed === 'Standard SOLECTRUS Sensoren'
	) {
		return DEFAULT_SENSOR_GROUP_KEY;
	}
	if (trimmed === CUSTOM_SENSOR_GROUP_KEY || trimmed === 'Benutzerdefiniert') {
		return CUSTOM_SENSOR_GROUP_KEY;
	}
	return trimmed;
}

function getSensorGroupKey(sensor) {
	if (hasExplicitSensorGroup(sensor)) {
		return canonicalizeSensorGroupName(sensor.group);
	}
	if (isDefaultSensorName(sensor && sensor.SensorName)) {
		return DEFAULT_SENSOR_GROUP_KEY;
	}
	return String((sensor && sensor.SensorName) || '').trim() ? CUSTOM_SENSOR_GROUP_KEY : '';
}

function sensorStateIcon(sensor) {
	const enabled = !!(sensor && sensor.enabled);
	const internal = !!(sensor && sensor.internal);
	if (!enabled) {
		return '⚪';
	}
	return internal ? '🟡' : '🟢';
}

/**
 * Creates the top-level ioBroker object tree (info, info.buffer, sensors channels) if not yet present.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function ensureObjectTree(adapter) {
	// info channel
	await adapter.setObjectNotExistsAsync('info', {
		type: 'channel',
		common: { name: 'Info' },
		native: {},
	});

	// buffer channel
	await adapter.setObjectNotExistsAsync('info.buffer', {
		type: 'channel',
		common: { name: 'Buffer' },
		native: {},
	});

	// sensors channel
	await adapter.setObjectNotExistsAsync('sensors', {
		type: 'channel',
		common: { name: 'Sensors' },
		native: {},
	});
}

/**
 * Creates all info/* state objects (connection, buffer size/oldest, manual clear, lastError).
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function createInfoStates(adapter) {
	await adapter.setObjectNotExistsAsync('info.connection', {
		type: 'state',
		common: {
			name: 'Device or service connected',
			type: 'boolean',
			role: 'indicator.connected',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.size', {
		type: 'state',
		common: {
			name: 'Buffered points',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.oldest', {
		type: 'state',
		common: {
			name: 'Oldest buffered timestamp',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.clear', {
		type: 'state',
		common: {
			name: 'Clear Buffer manually',
			type: 'boolean',
			role: 'button',
			read: false,
			write: true,
		},
		native: {},
	});
	adapter.subscribeStates('info.buffer.clear');

	await adapter.setObjectNotExistsAsync('info.lastError', {
		type: 'state',
		common: {
			name: 'Last Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});
}

/**
 * Ensures default sensor entries exist and updates the admin-visible sensor title labels.
 * Also performs first-run migration for the Data-SOLECTRUS enablement flag.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function ensureDefaultSensorsAndTitles(adapter) {
	try {
		const objId = `system.adapter.${adapter.namespace}`;
		const obj = await adapter.getForeignObjectAsync(objId);
		if (!obj || !obj.native || !Array.isArray(obj.native.sensors)) {
			return;
		}

		let changed = false;

		// Mark first-install flag (defaults come from io-package.json via ioBroker)
		if (!obj.native._defaultSensorsCreated) {
			obj.native._defaultSensorsCreated = true;
			changed = true;
		}

		// Migration: enable Data-SOLECTRUS formula engine by default for existing instances
		// Only applies when the field was never explicitly saved (undefined = old install
		// that pre-dates the checkbox).  An explicit false (user disabled it) is preserved.
		if (obj.native.enableDataSolectrus === undefined || obj.native.enableDataSolectrus === null) {
			obj.native.enableDataSolectrus = true;
			adapter.config.enableDataSolectrus = true;
			changed = true;
		}

		// --- Sensor titles ---
		for (const sensor of obj.native.sensors) {
			if (!sensor || typeof sensor !== 'object') {
				continue;
			}
			if (sensor.internal === undefined || sensor.internal === null) {
				sensor.internal = false;
				changed = true;
			}
			const group = getSensorGroupKey(sensor);
			if (hasExplicitSensorGroup(sensor)) {
				if (sensor.group !== group) {
					sensor.group = group;
					changed = true;
				}
			} else if (group) {
				sensor.group = group;
				changed = true;
			}
			const sensorName = sensor.SensorName || 'Sensor';
			const expectedTitle = `${sensorStateIcon(sensor)} ${sensorName}`;
			if (sensor._title !== expectedTitle) {
				sensor._title = expectedTitle;
				changed = true;
			}
		}

		// Migrate named JSON forecast sensors from jsonPreset: 'auto' to specific presets.
		// 'auto' writes to ALL preset measurements simultaneously; specific presets write exactly one.
		for (const [name, specificPreset] of Object.entries(FORECAST_SENSOR_PRESETS)) {
			const sensor = obj.native.sensors.find(
				s => s && s.SensorName === name && s.type === 'json' && s.jsonPreset === 'auto',
			);
			if (sensor) {
				sensor.jsonPreset = specificPreset;
				changed = true;
			}
		}

		// Propagate sourceState from INVERTER_POWER_FORECAST to sibling forecast sensors.
		// When the main sensor is configured, siblings should write to their own measurement
		// from the same source rather than staying unconfigured.
		const mainFc = obj.native.sensors.find(
			s => s && s.SensorName === 'INVERTER_POWER_FORECAST' && s.type === 'json',
		);
		if (mainFc && mainFc.sourceState) {
			for (const siblingName of ['INVERTER_POWER_FORECAST_CLEARSKY', 'OUTDOOR_TEMP_FORECAST']) {
				const sibling = obj.native.sensors.find(s => s && s.SensorName === siblingName && s.type === 'json');
				if (sibling && !sibling.sourceState) {
					sibling.sourceState = mainFc.sourceState;
					sibling.enabled = mainFc.enabled;
					changed = true;
				}
			}
		}

		if (changed) {
			await adapter.setForeignObject(objId, obj);
			adapter.config.sensors = obj.native.sensors;
		}
	} catch (e) {
		adapter.log.warn(`Cannot ensure default sensors / titles: ${e}`);
	}
}

module.exports = { ensureObjectTree, createInfoStates, ensureDefaultSensorsAndTitles, migrateLegacyForecastConfig };

/**
 * Migrates legacy forecast configuration (enableForecast / forecasts[]) to the JSON sensor system.
 *
 * Maps each enabled legacy forecast entry's sourceState onto the matching new JSON sensor
 * and removes the legacy keys from the persisted adapter config.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {Promise<boolean>} True when migration was persisted successfully.
 */
async function migrateLegacyForecastConfig(adapter) {
	if (!adapter.config.enableForecast) {
		return false;
	}

	adapter.log.info('Legacy forecast configuration detected – running automatic migration to JSON sensors');

	const forecasts = Array.isArray(adapter.config.forecasts) ? adapter.config.forecasts : [];
	const enabled = forecasts.filter(fc => fc && fc.enabled && fc.sourceState);

	if (enabled.length > 0) {
		const uniqueSources = [...new Set(enabled.map(fc => fc.sourceState))];
		const sensors = adapter.config.sensors;

		if (uniqueSources.length === 1) {
			// All entries share one source → configure each sensor with its specific preset
			const sourceState = uniqueSources[0];
			for (const [sensorName, preset] of Object.entries(FORECAST_SENSOR_PRESETS)) {
				const target = sensors.find(s => s && s.SensorName === sensorName && s.type === 'json');
				if (target && !target.sourceState) {
					target.sourceState = sourceState;
					target.enabled = true;
					target.jsonPreset = preset;
					adapter.log.info(
						`Migration: configured ${sensorName} (sourceState: "${sourceState}", preset: "${preset}")`,
					);
				} else if (target && target.sourceState) {
					adapter.log.info(
						`Migration: ${sensorName} already has sourceState "${target.sourceState}" – skipping`,
					);
				}
			}
		} else {
			// Different sources per field → configure each sensor with its specific preset
			const presetMap = {
				y: { sensorName: 'INVERTER_POWER_FORECAST', preset: 'forecast' },
				clearsky: { sensorName: 'INVERTER_POWER_FORECAST_CLEARSKY', preset: 'clearsky' },
				temp: { sensorName: 'OUTDOOR_TEMP_FORECAST', preset: 'temperature' },
			};

			const byValField = {};
			for (const fc of enabled) {
				const vf = fc.valField || 'y';
				if (!byValField[vf]) {
					byValField[vf] = fc.sourceState;
				}
			}

			for (const [valField, sourceState] of Object.entries(byValField)) {
				const mapping = presetMap[valField];
				if (!mapping) {
					continue;
				}
				const target = sensors.find(s => s && s.SensorName === mapping.sensorName && s.type === 'json');
				if (target && !target.sourceState) {
					target.sourceState = sourceState;
					target.enabled = true;
					target.jsonPreset = mapping.preset;
					adapter.log.info(
						`Migration: set sourceState "${sourceState}" on ${mapping.sensorName} (preset: ${mapping.preset})`,
					);
				}
			}
		}
	}

	// Persist updated sensors and remove legacy keys
	try {
		const objId = `system.adapter.${adapter.namespace}`;
		const obj = await adapter.getForeignObjectAsync(objId);
		if (obj && obj.native) {
			obj.native.sensors = adapter.config.sensors;
			delete obj.native.enableForecast;
			delete obj.native.forecasts;
			await adapter.setForeignObjectAsync(objId, obj);
			delete adapter.config.enableForecast;
			delete adapter.config.forecasts;
			adapter.log.info('Migration complete: legacy forecast keys removed from adapter config');
			return true;
		}
	} catch (err) {
		adapter.log.error(`Migration failed to persist: ${err.message}`);
	}
	return false;
}
