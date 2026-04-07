'use strict';

const { JSON_PRESETS } = require('./constants');
const { getSensorStateId, parseJsonArray, parseTimestamp, parseInfluxValue, parseFieldTypeConflictError } =
	require('./helpers');
const { saveBuffer, updateBufferStates } = require('./bufferManager');

async function prepareSensors(adapter) {
	for (const sensor of adapter.config.sensors) {
		if (adapter.isUnloading) {
			break;
		}
		if (!sensor || !sensor.enabled) {
			continue;
		}

		const id = getSensorStateId(sensor);

		const typeMapping = {
			int: 'number',
			float: 'number',
			bool: 'boolean',
			string: 'string',
			json: 'string',
		};

		const iobType = typeMapping[sensor.type] || 'mixed';
		const obj = await adapter.getObjectAsync(id);

		if (!obj) {
			await adapter.setObjectAsync(id, {
				type: 'state',
				common: {
					name: sensor.SensorName,
					type: iobType,
					role: 'value',
					read: true,
					write: false,
				},
				native: { sourceState: sensor.sourceState },
			});
		} else {
			adapter.extendObject(id, {
				type: 'state',
				common: {
					name: sensor.SensorName,
					type: iobType,
					role: 'value',
					read: true,
					write: false,
				},
				native: { sourceState: sensor.sourceState },
			});
		}

		// JSON sensors: read initial value (filtered to relevant fields only),
		// map sourceState, but skip foreignObj check and subscribeForeignStates
		// (done in prepareJsonSensors)
		if (sensor.type === 'json') {
			if (sensor.sourceState) {
				adapter.sourceToSensorId[sensor.sourceState] = id;
				const cfg = getJsonSensorConfig(sensor);
				const state = await adapter.getForeignStateAsync(sensor.sourceState);
				if (state && state.val != null) {
					let filtered;
					if (cfg.autoDetect) {
						filtered = extractJsonSensorValuesAuto(adapter, state.val, cfg.tsField);
					} else {
						filtered = extractJsonSensorValues(adapter, state.val, cfg.tsField, cfg.valField);
					}
					if (filtered) {
						adapter.setState(id, filtered, true);
					}
				}
			}
			// Always use current time as baseline so JSON sensors also get a grace period after restart
			adapter.lastUpdateTs.set(id, Date.now());
			continue;
		}

		if (!sensor.sourceState) {
			continue;
		}

		// ds.* states from this adapter may not exist yet (created by initDataSolectrus later)
		const isOwnDsState = sensor.sourceState.startsWith(`${adapter.namespace}.ds.`);
		const foreignObj = await adapter.getForeignObjectAsync(sensor.sourceState);
		if (!foreignObj && !isOwnDsState) {
			adapter.log.warn(`Source state not found: ${sensor.sourceState}`);
			continue;
		}

		adapter.sourceToSensorId[sensor.sourceState] = id;

		const state = await adapter.getForeignStateAsync(sensor.sourceState);
		if (state) {
			adapter.cache[id] = state.val;
			adapter.setState(id, state.val, true);
		}
		// Always use current time as baseline so every sensor gets a grace period after restart
		adapter.lastUpdateTs.set(id, Date.now());

		adapter.subscribeForeignStates(sensor.sourceState);
	}

	// Prepare JSON-type sensors (forecast/weather data)
	await prepareJsonSensors(adapter);
}

function getJsonSensorConfig(sensor) {
	// Auto-detection: scan JSON data for all known value fields
	if (sensor.jsonPreset === 'auto') {
		return { autoDetect: true, tsField: 't' };
	}

	const preset = JSON_PRESETS[sensor.jsonPreset];
	if (preset) {
		// Preset provides defaults, but user-defined measurement/field take priority
		return {
			tsField: preset.tsField,
			valField: preset.valField,
			measurement: sensor.measurement || preset.measurement,
			field: sensor.field || preset.field,
			influxType: preset.influxType,
		};
	}
	// Custom preset: user-defined fields
	return {
		tsField: sensor.jsonTsField || 't',
		valField: sensor.jsonValField || 'y',
		measurement: sensor.measurement || 'custom_json',
		field: sensor.field || 'value',
		influxType: sensor.jsonInfluxType || 'float',
	};
}

function extractJsonSensorValues(adapter, jsonVal, tsField, valField) {
	const data = parseJsonArray(adapter, jsonVal, 'extractJsonSensorValues', true);
	if (!data) {
		return null;
	}
	const filtered = [];
	for (const entry of data) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		if (entry[tsField] != null && entry[valField] != null) {
			filtered.push({ [tsField]: entry[tsField], [valField]: entry[valField] });
		}
	}
	return JSON.stringify(filtered);
}

function extractJsonSensorValuesAuto(adapter, jsonVal, tsField) {
	const data = parseJsonArray(adapter, jsonVal, 'extractJsonSensorValuesAuto', true);
	if (!data) {
		return null;
	}
	const knownFields = Object.values(JSON_PRESETS).map(p => p.valField);
	const filtered = [];
	for (const entry of data) {
		if (!entry || typeof entry !== 'object' || entry[tsField] == null) {
			continue;
		}
		const obj = { [tsField]: entry[tsField] };
		let hasField = false;
		for (const vf of knownFields) {
			if (entry[vf] != null) {
				obj[vf] = entry[vf];
				hasField = true;
			}
		}
		if (hasField) {
			filtered.push(obj);
		}
	}
	return JSON.stringify(filtered);
}

async function prepareJsonSensors(adapter) {
	adapter.jsonSourceMap = {};

	for (const sensor of adapter.config.sensors) {
		if (!sensor || !sensor.enabled || sensor.type !== 'json') {
			continue;
		}

		if (!sensor.sourceState) {
			adapter.log.warn(`JSON sensor "${sensor.SensorName}" has no source state`);
			continue;
		}

		const cfg = getJsonSensorConfig(sensor);

		if (!adapter.jsonSourceMap[sensor.sourceState]) {
			adapter.jsonSourceMap[sensor.sourceState] = [];
		}
		adapter.jsonSourceMap[sensor.sourceState].push({
			sensorName: sensor.SensorName,
			...cfg,
		});
	}

	const sourceStates = Object.keys(adapter.jsonSourceMap);
	if (sourceStates.length === 0) {
		return;
	}

	adapter.log.info(`JSON sensors: subscribing to ${sourceStates.length} JSON source(s)`);
	for (const stateId of sourceStates) {
		adapter.subscribeForeignStates(stateId);
	}
}

function processJsonSensorData(adapter, sourceState, jsonVal) {
	const mappings = adapter.jsonSourceMap[sourceState];
	if (!mappings || mappings.length === 0) {
		return;
	}

	const data = parseJsonArray(adapter, jsonVal, sourceState);
	if (!data) {
		return;
	}

	let totalPoints = 0;
	const presetValues = Object.values(JSON_PRESETS);

	for (const mapping of mappings) {
		// Auto-detection: scan for all known value fields in each entry
		if (mapping.autoDetect) {
			for (const entry of data) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}

				const rawTs = entry[mapping.tsField];
				if (rawTs == null) {
					continue;
				}

				const ts = parseTimestamp(rawTs);
				if (!Number.isFinite(ts)) {
					adapter.log.debug(`JSON sensor: invalid timestamp ${rawTs} in ${sourceState}`);
					continue;
				}

				for (const preset of presetValues) {
					const rawVal = entry[preset.valField];
					if (rawVal == null) {
						continue;
					}

					const value = parseInfluxValue(rawVal, preset.influxType);
					if (Number.isNaN(value)) {
						continue;
					}

					adapter.buffer.push({
						id: `${mapping.sensorName}_${preset.valField}`,
						measurement: preset.measurement,
						field: preset.field,
						type: preset.influxType,
						value,
						ts,
					});
					totalPoints++;
				}
			}
			continue;
		}

		// Standard mapping (specific preset or custom)
		for (const entry of data) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}

			const rawTs = entry[mapping.tsField];
			const rawVal = entry[mapping.valField];
			if (rawTs == null || rawVal == null) {
				continue;
			}

			const ts = parseTimestamp(rawTs);
			if (!Number.isFinite(ts)) {
				adapter.log.debug(`JSON sensor: invalid timestamp ${rawTs} in ${sourceState}`);
				continue;
			}

			const value = parseInfluxValue(rawVal, mapping.influxType);
			if (Number.isNaN(value)) {
				continue;
			}

			adapter.buffer.push({
				id: mapping.sensorName,
				measurement: mapping.measurement,
				field: mapping.field,
				type: mapping.influxType,
				value,
				ts,
			});
			totalPoints++;
		}
	}

	if (totalPoints > 0) {
		adapter.log.info(`JSON sensor: buffered ${totalPoints} points from ${sourceState}`);

		if (adapter.buffer.length > adapter.maxBufferSize) {
			adapter.log.warn('Buffer limit reached – dropping oldest entries');
			adapter.buffer.splice(0, adapter.buffer.length - adapter.maxBufferSize);
		}

		saveBuffer(adapter);
		updateBufferStates(adapter);

		// Trigger immediate flush
		if (!adapter.isFlushing) {
			adapter.scheduleNextFlush(0);
		}
	}
}

function disableSensorByFieldTypeConflict(adapter, err) {
	const conflict = parseFieldTypeConflictError(err);
	if (!conflict) {
		return;
	}

	const { measurement, field } = conflict;
	const sensor = adapter.config.sensors.find(s => s && s.measurement === measurement && s.field === field);

	if (!sensor) {
		adapter.log.warn(`No sensor found for measurement "${measurement}" and field "${field}".`);
		return;
	}

	sensor.enabled = false;

	const msg = `Sensor "${sensor.SensorName}" was deactivated because of Field-Type-Conflict (measurement: ${measurement}, field: ${field})`;
	adapter.log.error(msg);
	adapter.setState('info.lastError', msg, true);
}

module.exports = {
	prepareSensors,
	getJsonSensorConfig,
	extractJsonSensorValues,
	extractJsonSensorValuesAuto,
	prepareJsonSensors,
	processJsonSensorData,
	disableSensorByFieldTypeConflict,
};
