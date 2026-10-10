'use strict';

const ioPack = require('../io-package.json');

const DEFAULT_SENSOR_GROUP_KEY = 'Default SOLECTRUS sensors';
const CUSTOM_SENSOR_GROUP_KEY = 'Custom sensors';

/**
 * Folders of the default sensors, in the order and with the names of the sensor overview of
 * HELIOS (the SOLECTRUS configuration app). Each car has a folder of its own.
 */
const SENSOR_GROUPS = [
	{ key: 'Inverter', patterns: [/^INVERTER_POWER(?:_[1-5])?$/, /^CASE_TEMP$/, /^SYSTEM_STATUS(?:_OK)?$/] },
	{ key: 'Grid', patterns: [/^GRID_(?:IMPORT_POWER|EXPORT_POWER|EXPORT_LIMIT)$/, /^HOUSE_POWER$/] },
	{ key: 'Battery', patterns: [/^BATTERY_(?:CHARGING_POWER|DISCHARGING_POWER|SOC)$/] },
	{ key: 'Wallbox', patterns: [/^WALLBOX_(?:POWER|CONNECTED|CAR_CONNECTED)$/] },
	...[1, 2, 3, 4, 5].map(n => ({
		key: `Electric Car ${n}`,
		patterns: [
			new RegExp(`^CAR_(?:BATTERY_SOC|ODOMETER|MILEAGE|RANGE|CONNECTED|LATITUDE|LONGITUDE)_${n}$`),
			// SOLECTRUS reads CAR_BATTERY_SOC as CAR_BATTERY_SOC_1
			...(n === 1 ? [/^CAR_BATTERY_SOC$/] : []),
		],
	})),
	{
		key: 'Heat Pump',
		patterns: [/^HEATPUMP_(?:POWER|HEATING_POWER|TANK_TEMP|TANK_TEMP_SETPOINT|STATUS)$/, /^OUTDOOR_TEMP$/],
	},
	{ key: 'Forecast', patterns: [/^INVERTER_POWER_FORECAST(?:_CLEARSKY)?$/, /^OUTDOOR_TEMP_FORECAST$/] },
	{ key: 'Custom Consumer', patterns: [/^CUSTOM_POWER_\d{2}$/] },
];

/**
 * Returns the HELIOS folder of a default sensor, or '' for any other sensor name.
 *
 * @param {unknown} name - The sensor name.
 * @returns {string} The group key.
 */
function getDefaultSensorGroup(name) {
	const sensorName = String(name || '').trim();
	const group = SENSOR_GROUPS.find(g => g.patterns.some(pattern => pattern.test(sensorName)));
	return group ? group.key : '';
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
	const defaultGroup = getDefaultSensorGroup(sensor && sensor.SensorName);
	if (hasExplicitSensorGroup(sensor)) {
		const group = canonicalizeSensorGroupName(sensor.group);
		// The former single folder of all default sensors is split into the HELIOS folders
		return group === DEFAULT_SENSOR_GROUP_KEY && defaultGroup ? defaultGroup : group;
	}
	if (defaultGroup) {
		return defaultGroup;
	}
	return String((sensor && sensor.SensorName) || '').trim() ? CUSTOM_SENSOR_GROUP_KEY : '';
}

/**
 * Default sensors that every instance already got before missing defaults were added on start
 * (release 2.0.1). An instance without `_knownDefaultSensors` knows exactly these, so a sensor the
 * user deleted from this list does not come back. A new default sensor only needs an entry in
 * io-package.json; it must not be added here.
 */
const BASELINE_DEFAULT_SENSOR_NAMES = [
	'INVERTER_POWER',
	...[1, 2, 3, 4, 5].map(n => `INVERTER_POWER_${n}`),
	'GRID_IMPORT_POWER',
	'GRID_EXPORT_POWER',
	'GRID_EXPORT_LIMIT',
	'CASE_TEMP',
	'SYSTEM_STATUS',
	'SYSTEM_STATUS_OK',
	'BATTERY_SOC',
	'BATTERY_CHARGING_POWER',
	'BATTERY_DISCHARGING_POWER',
	'HOUSE_POWER',
	'HEATPUMP_POWER',
	...Array.from({ length: 20 }, (_, i) => `CUSTOM_POWER_${String(i + 1).padStart(2, '0')}`),
	'WALLBOX_POWER',
	'WALLBOX_CONNECTED',
	'CAR_BATTERY_SOC',
	'HEATPUMP_HEATING_POWER',
	'HEATPUMP_TANK_TEMP',
	'HEATPUMP_TANK_TEMP_SETPOINT',
	'HEATPUMP_STATUS',
	'OUTDOOR_TEMP',
	'INVERTER_POWER_FORECAST',
	'INVERTER_POWER_FORECAST_CLEARSKY',
	'OUTDOOR_TEMP_FORECAST',
];

function sensorTarget(sensor) {
	const measurement = String((sensor && sensor.measurement) || '')
		.trim()
		.toLowerCase();
	const field = String((sensor && sensor.field) || '')
		.trim()
		.toLowerCase();
	return measurement && field ? `${measurement}:${field}` : '';
}

/**
 * Appends the default sensors of io-package.json that the instance does not know yet, disabled.
 * A default counts as present when a sensor has its name or writes its measurement and field, so
 * a renamed sensor (CAR_BATTERY_SOC for CAR_BATTERY_SOC_1) is not added twice. Every default is
 * then recorded in `native._knownDefaultSensors`, so a deleted one is never added again.
 *
 * @param {{ sensors: Array<Record<string, unknown>>, _knownDefaultSensors?: string[] }} native - The native part of the instance object; changed in place.
 * @param {Array<Record<string, unknown>>} [defaults] - The default sensors, by default those of io-package.json.
 * @returns {string[]} The names of the added sensors.
 */
function addMissingDefaultSensors(native, defaults = ioPack.native.sensors) {
	const defaultSensors = (Array.isArray(defaults) ? defaults : []).filter(
		d => d && typeof d === 'object' && String(d.SensorName || '').trim(),
	);
	const known = new Set(
		Array.isArray(native._knownDefaultSensors) ? native._knownDefaultSensors : BASELINE_DEFAULT_SENSOR_NAMES,
	);
	const sensors = native.sensors;
	const names = new Set(sensors.map(s => String((s && s.SensorName) || '').trim()));
	const targets = new Set(sensors.map(sensorTarget).filter(Boolean));

	const added = [];
	for (const def of defaultSensors) {
		const name = String(def.SensorName).trim();
		if (known.has(name) || names.has(name) || targets.has(sensorTarget(def))) {
			continue;
		}
		sensors.push({ ...JSON.parse(JSON.stringify(def)), enabled: false });
		names.add(name);
		added.push(name);
	}

	native._knownDefaultSensors = Array.from(
		new Set([...known, ...defaultSensors.map(d => String(d.SensorName).trim())]),
	);
	return added;
}

/**
 * SOLECTRUS renamed the car sensor CAR_MILEAGE_<n> to CAR_ODOMETER_<n> before its release, so a
 * sensor of the development version gets the new name, and the field "mileage" of the former
 * default becomes "odometer". A field the user chose stays.
 *
 * @param {{ sensors: Array<Record<string, unknown>>, _knownDefaultSensors?: string[] }} native - The native part of the instance object; changed in place.
 * @returns {string[]} The new names of the renamed sensors.
 */
function migrateCarMileageToOdometer(native) {
	const renamed = [];
	for (const sensor of native.sensors) {
		const match = /^CAR_MILEAGE_([1-5])$/.exec(String((sensor && sensor.SensorName) || '').trim());
		if (!match) {
			continue;
		}
		const name = `CAR_ODOMETER_${match[1]}`;
		sensor.SensorName = name;
		if (sensor.field === 'mileage') {
			sensor.field = 'odometer';
		}
		renamed.push(name);
	}
	return renamed;
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

		const renamed = migrateCarMileageToOdometer(obj.native);
		if (renamed.length) {
			changed = true;
			adapter.log.info(`Renamed car sensors (SOLECTRUS name): ${renamed.join(', ')}`);
		}

		// New default sensors from io-package.json, for instances installed before they existed
		const knownBefore = JSON.stringify(obj.native._knownDefaultSensors);
		const added = addMissingDefaultSensors(obj.native);
		if (added.length || JSON.stringify(obj.native._knownDefaultSensors) !== knownBefore) {
			changed = true;
		}
		if (added.length) {
			adapter.log.info(`Added new default sensors (disabled): ${added.join(', ')}`);
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

		if (changed) {
			await adapter.setForeignObject(objId, obj);
			adapter.config.sensors = obj.native.sensors;
		}
	} catch (e) {
		adapter.log.warn(`Cannot ensure default sensors / titles: ${e}`);
	}
}

module.exports = {
	ensureObjectTree,
	createInfoStates,
	ensureDefaultSensorsAndTitles,
	addMissingDefaultSensors,
	migrateCarMileageToOdometer,
	getDefaultSensorGroup,
	migrateLegacyForecastConfig,
};

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

		// Map valField → sensor name for the three default forecast sensors
		const valFieldToSensor = {
			y: 'INVERTER_POWER_FORECAST',
			clearsky: 'INVERTER_POWER_FORECAST_CLEARSKY',
			temp: 'OUTDOOR_TEMP_FORECAST',
		};

		if (uniqueSources.length === 1) {
			// All entries share one source → one auto sensor covers all fields
			const sourceState = uniqueSources[0];
			const target = sensors.find(s => s && s.SensorName === 'INVERTER_POWER_FORECAST' && s.type === 'json');
			if (target && !target.sourceState) {
				target.sourceState = sourceState;
				target.enabled = true;
				adapter.log.info(`Migration: configured INVERTER_POWER_FORECAST with sourceState "${sourceState}"`);
			} else if (target) {
				adapter.log.info(
					`Migration: INVERTER_POWER_FORECAST already has sourceState "${target.sourceState}" – skipping`,
				);
			} else {
				adapter.log.warn('Migration: INVERTER_POWER_FORECAST sensor not found – please configure manually');
			}
		} else {
			// Different sources per field → configure each sensor individually (auto preset handles its source)
			const byValField = {};
			for (const fc of enabled) {
				const vf = fc.valField || 'y';
				if (!byValField[vf]) {
					byValField[vf] = fc.sourceState;
				}
			}

			for (const [valField, sourceState] of Object.entries(byValField)) {
				const sensorName = valFieldToSensor[valField];
				if (!sensorName) {
					continue;
				}
				const target = sensors.find(s => s && s.SensorName === sensorName && s.type === 'json');
				if (target && !target.sourceState) {
					target.sourceState = sourceState;
					target.enabled = true;
					adapter.log.info(`Migration: set sourceState "${sourceState}" on ${sensorName}`);
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
