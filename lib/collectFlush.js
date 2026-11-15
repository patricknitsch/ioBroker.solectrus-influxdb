'use strict';

const { Point } = require('@influxdata/influxdb-client');
const { DEFAULT_MAX_VALUE } = require('./constants');
const {
	getSensorStateId,
	hasEnabledSensors,
	getFlushIntervalMs,
	clampDelay,
	isFieldTypeConflict,
} = require('./helpers');
const { saveBuffer, updateBufferStates, clearBuffer } = require('./bufferManager');
const { ensureInflux, closeWriteApi } = require('./influxManager');
const { sendNotification } = require('./notificationManager');
const { getNotificationMessage } = require('./notificationMessages');

/** Fixed retry interval (ms) when the current sensor value is 0 – devices may send less frequently at zero. */
const ALIVE_ZERO_RETRY_MS = 60 * 60_000;

/**
 * Polls all enabled non-JSON sensors from the cache, validates values against the configured
 * maximum, and appends points to the buffer. Triggers a flush when the buffer is non-empty.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function collectPoints(adapter) {
	const now = Date.now();
	const initialBufferLength = adapter.buffer.length;
	// Stale inputs of Data-SOLECTRUS items per sensor name, shown in the overview tab
	const staleInputs = {};
	// Names of the sensors that are stale (own timeout or a stale input), shown in the device manager
	const staleSensors = [];
	// Stale inputs found by sensors per item output id, also shown at the item in the overview tab
	const staleItemInputsBySensors = {};

	for (const sensor of adapter.config.sensors) {
		if (!sensor || !sensor.enabled) {
			continue;
		}

		const id = getSensorStateId(sensor);

		// Check alive timeout (throttle: warn at most once per timeout period per sensor)
		const sensorAliveTimeoutMs = sensor.aliveTimeoutMinutes > 0 ? sensor.aliveTimeoutMinutes * 60_000 : 0;
		if (sensorAliveTimeoutMs > 0) {
			let isSensorStale = checkAliveTimeout(
				adapter,
				sensor,
				id,
				'',
				adapter.lastUpdateTs.get(id),
				adapter.cache[id],
				sensorAliveTimeoutMs,
				now,
			);

			// A sensor fed by a Data-SOLECTRUS item gets a new value on every tick, even when the
			// inputs of the formula are stale. Check each input of the item as well.
			if (adapter.dsProxy) {
				for (const inputId of getDsInputIds(adapter, sensor.sourceState)) {
					const lastTs = adapter.dsProxy.cacheTs.get(inputId);
					const isStale = checkAliveTimeout(
						adapter,
						sensor,
						`${id}|${inputId}`,
						inputId,
						lastTs,
						adapter.dsProxy.cache.get(inputId),
						sensorAliveTimeoutMs,
						now,
					);
					if (isStale) {
						isSensorStale = true;
						(staleInputs[sensor.SensorName] = staleInputs[sensor.SensorName] || []).push({
							id: inputId,
							ts: lastTs,
						});
						const outputId = sensor.sourceState.slice(`${adapter.namespace}.ds.`.length);
						const list = (staleItemInputsBySensors[outputId] = staleItemInputsBySensors[outputId] || []);
						if (!list.some(inp => inp.id === inputId)) {
							list.push({ id: inputId, ts: lastTs });
						}
					}
				}
			}
			if (isSensorStale) {
				staleSensors.push(sensor.SensorName);
			}
		}

		// JSON sensors are event-driven (written on source state change), not polled.
		// Sensors with "write on change" are written by writeSensorChange() with their own timestamp.
		if (sensor.type === 'json' || sensor.writeOnChange) {
			continue;
		}

		bufferSensorValue(adapter, sensor, id, adapter.cache[id], now, now);
	}

	const staleInputsJson = JSON.stringify(staleInputs);
	if (adapter.staleInputsJson !== staleInputsJson) {
		adapter.staleInputsJson = staleInputsJson;
		adapter.setState('info.staleInputs', staleInputsJson, true);
	}

	const staleSensorsJson = JSON.stringify(staleSensors);
	if (adapter.staleSensorsJson !== staleSensorsJson) {
		adapter.staleSensorsJson = staleSensorsJson;
		adapter.setState('info.staleSensors', staleSensorsJson, true);
	}

	// Items checked by a sensor show the stale inputs the sensor found (no second log message)
	const staleItemInputsJson = JSON.stringify(
		Object.assign(checkDsItemsAlive(adapter, now), staleItemInputsBySensors),
	);
	if (adapter.staleItemInputsJson !== staleItemInputsJson) {
		adapter.staleItemInputsJson = staleItemInputsJson;
		adapter.setState('info.staleFormulaInputs', staleItemInputsJson, true);
	}

	if (adapter.buffer.length > initialBufferLength) {
		saveBuffer(adapter);
	}
	updateBufferStates(adapter);

	// Trigger flush immediately after collect (if not already running)
	if (adapter.buffer.length > 0 && !adapter.isFlushing) {
		scheduleNextFlush(adapter, 0);
	}
}

/**
 * Logs a warning (and optionally sends a notification) when a sensor, or one input of the
 * Data-SOLECTRUS item feeding it, has not been updated within the alive timeout.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} sensor - The sensor configuration.
 * @param {string} key - Throttle key (sensor state id, or sensor state id + input id).
 * @param {string} inputId - Id of the monitored item input, or '' for the sensor itself.
 * @param {number|undefined} lastTs - Timestamp (ms) of the last update.
 * @param {unknown} currentValue - The current value.
 * @param {number} sensorAliveTimeoutMs - The alive timeout (ms).
 * @param {number} now - The current time (ms).
 * @returns {boolean} True when the value is stale as shown in the overview tab
 *   (older than the timeout, or older than 60 minutes when the value is 0).
 */
function checkAliveTimeout(adapter, sensor, key, inputId, lastTs, currentValue, sensorAliveTimeoutMs, now) {
	const name = inputId ? `${sensor.SensorName} → ${inputId}` : sensor.SensorName;
	// Inputs of a formula engine item without sensor are reported as "Formula"
	const kind = sensor.isFormula ? 'Formula' : 'Sensor';
	if (typeof lastTs === 'number' && lastTs > 0 && now - lastTs > sensorAliveTimeoutMs) {
		const lastTsStr = new Date(lastTs).toLocaleString();
		const expectedByStr = new Date(lastTs + sensorAliveTimeoutMs).toLocaleString();
		const isCurrentlyZero = currentValue === 0 || currentValue === '0';

		// Log throttling (throttle period is longer when the current value is zero)
		const lastWarnTs = adapter.aliveWarnedAt.get(key) || 0;
		const throttleMs = isCurrentlyZero ? ALIVE_ZERO_RETRY_MS : sensorAliveTimeoutMs;
		if (now - lastWarnTs >= throttleMs) {
			adapter.aliveWarnedAt.set(key, now);
			if (isCurrentlyZero) {
				adapter.log.info(
					`${kind} "${name}": no update since ${lastTsStr} (update expected by ${expectedByStr}) – current value is 0, next check in 60 minutes`,
				);
			} else {
				adapter.log.warn(
					`${kind} "${name}": no update since ${lastTsStr} (update expected by ${expectedByStr})`,
				);
			}
		}

		// Notification throttling is independent of log throttling; skip for zero-value sensors
		if (!isCurrentlyZero && adapter.config.notifyOnSensorTimeout) {
			const notifyRepeatMs = (adapter.config.notifyRepeatMinutes || 60) * 60_000;
			const lastNotifyTs = adapter.aliveNotifyAt.get(key) || 0;
			if (now - lastNotifyTs >= notifyRepeatMs) {
				adapter.aliveNotifyAt.set(key, now);
				sendNotification(
					adapter,
					getNotificationMessage(adapter, sensor.isFormula ? 'formulaTimeout' : 'sensorTimeout', {
						name,
						lastTs: lastTsStr,
						expectedBy: expectedByStr,
					}),
				).catch(() => {});
			}
		}
		return now - lastTs > (isCurrentlyZero ? ALIVE_ZERO_RETRY_MS : sensorAliveTimeoutMs);
	}
	return false;
}

/**
 * Returns the source ids of the Data-SOLECTRUS item whose output is the given state.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} sourceState - The source state of the sensor.
 * @returns {string[]} The input ids, or an empty array when the source is no item output.
 */
function getDsInputIds(adapter, sourceState) {
	const prefix = `${adapter.namespace}.ds.`;
	if (typeof sourceState !== 'string' || !sourceState.startsWith(prefix)) {
		return [];
	}
	return getDsItemInputIds(adapter, sourceState.slice(prefix.length));
}

/**
 * Returns the source ids of the Data-SOLECTRUS item with the given output id.
 * Inputs that are outputs of other items are resolved to the inputs of those items. Other own
 * states are skipped: their updates do not reach the Data-SOLECTRUS cache. Inputs (and the
 * source of a "source" item) with monitoring turned off (`noMonitoring`) are skipped too.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} outputId - The output id of the item (relative to `ds.`).
 * @returns {string[]} The input ids, or an empty array when there is no such item.
 */
function getDsItemInputIds(adapter, outputId) {
	const prefix = `${adapter.namespace}.ds.`;
	const compiledItems = adapter.dsProxy && adapter.dsProxy.compiledItems;
	const result = [];
	if (!compiledItems) {
		return result;
	}
	const visited = new Set();
	const collect = outputId => {
		const compiled = compiledItems.get(outputId);
		if (!compiled || visited.has(outputId)) {
			return;
		}
		visited.add(outputId);
		const item = compiled.item || {};
		const unmonitored = new Set();
		if (item.noMonitoring && item.sourceState) {
			unmonitored.add(String(item.sourceState));
		}
		for (const inp of Array.isArray(item.inputs) ? item.inputs : []) {
			if (inp && inp.noMonitoring && inp.sourceState) {
				unmonitored.add(String(inp.sourceState));
			}
		}
		for (const inputId of compiled.sourceIds || []) {
			if (unmonitored.has(inputId)) {
				continue;
			}
			if (inputId.startsWith(prefix) && compiledItems.has(inputId.slice(prefix.length))) {
				collect(inputId.slice(prefix.length));
			} else if (!inputId.startsWith(`${adapter.namespace}.`) && !result.includes(inputId)) {
				result.push(inputId);
			}
		}
	};
	collect(outputId);
	return result;
}

/**
 * Checks the inputs of all enabled Data-SOLECTRUS items that have their own alive timeout,
 * so items that only are used internally (not by a sensor) can be monitored too.
 * Sensors take precedence: an item used by an enabled sensor is checked by that sensor only.
 * An item not used by an enabled sensor is checked with its own timeout, even when a sensor
 * checks the same input through another item.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {number} now - The current time (ms).
 * @returns {object} Stale inputs per item output id: { [outputId]: [{ id, ts }] }.
 */
function checkDsItemsAlive(adapter, now) {
	const staleItemInputs = {};
	const compiledItems = adapter.dsProxy && adapter.dsProxy.compiledItems;
	if (!compiledItems) {
		return staleItemInputs;
	}
	const prefix = `${adapter.namespace}.ds.`;
	const usedByItems = new Set();
	for (const sensor of adapter.config.sensors || []) {
		if (
			sensor &&
			sensor.enabled &&
			typeof sensor.sourceState === 'string' &&
			sensor.sourceState.startsWith(prefix)
		) {
			usedByItems.add(sensor.sourceState.slice(prefix.length));
		}
	}
	for (const [outputId, compiled] of compiledItems) {
		const item = (compiled && compiled.item) || {};
		const timeoutMs = item.enabled && item.aliveTimeoutMinutes > 0 ? item.aliveTimeoutMinutes * 60_000 : 0;
		if (!timeoutMs) {
			continue;
		}
		// A sensor takes precedence: an item used by an enabled sensor is checked by that sensor only
		if (usedByItems.has(outputId)) {
			continue;
		}
		const pseudoSensor = { SensorName: `ds.${outputId}`, isFormula: true };
		for (const inputId of getDsItemInputIds(adapter, outputId)) {
			const lastTs = adapter.dsProxy.cacheTs.get(inputId);
			const isStale = checkAliveTimeout(
				adapter,
				pseudoSensor,
				`ds.${outputId}|${inputId}`,
				inputId,
				lastTs,
				adapter.dsProxy.cache.get(inputId),
				timeoutMs,
				now,
			);
			if (isStale) {
				(staleItemInputs[outputId] = staleItemInputs[outputId] || []).push({ id: inputId, ts: lastTs });
			}
		}
	}
	return staleItemInputs;
}

/**
 * Validates one sensor value against the configured maximum and appends it to the buffer.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} sensor - The sensor configuration.
 * @param {string} id - The sensor state id (sensors.*).
 * @param {unknown} value - The value to write.
 * @param {number} ts - The timestamp of the point (ms).
 * @param {number} now - The current time (ms), for warning throttles.
 * @returns {boolean} True when a point was buffered.
 */
function bufferSensorValue(adapter, sensor, id, value, ts, now) {
	if (value === undefined || value === null) {
		return false;
	}

	// Warn once per sensor when a negative value is collected
	if (typeof value === 'number' && value < 0 && !adapter.negativeValueWarned.has(id)) {
		adapter.negativeValueWarned.add(id);
		adapter.log.warn(
			`Sensor "${sensor.SensorName}" delivers negative value (${value}). Negative values will be sent to InfluxDB.`,
		);
	}

	// Validate against configured maximum value (for numeric-type sensors)
	// Uses parseInt for 'int' type, parseFloat for 'float'/standard – consistent with flushBuffer.
	// Non-numeric types (bool, string, json) are skipped.
	// Per-sensor maxValue takes precedence; default is 0 (disabled, DEFAULT_MAX_VALUE).
	// Any maxVal <= 0 or non-finite (NaN, Infinity) is treated as "monitoring disabled".
	const rawMax = sensor.maxValue != null ? sensor.maxValue : DEFAULT_MAX_VALUE;
	const maxVal = rawMax != null && Number(rawMax) > 0 ? Number(rawMax) : NaN;
	let valueToSend = value;
	if (Number.isFinite(maxVal) && sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json') {
		const numValue = sensor.type === 'int' ? parseInt(String(value), 10) : parseFloat(String(value));
		if (Number.isFinite(numValue)) {
			if (numValue > maxVal) {
				const lastValid = adapter.lastValidValue.get(id);
				const lastMaxWarnTs = adapter.maxValueWarnedAt.get(id) || 0;
				const maxValueThrottleMs = (adapter.config.notifyRepeatMinutes || 60) * 60_000;
				if (lastValid === undefined) {
					const warnMsg = `Sensor "${sensor.SensorName}" delivers implausible value (${numValue} > max ${maxVal}). No last valid value available, skipping point.`;
					adapter.log.warn(warnMsg);
					if (adapter.config.notifyOnMaxValueExceeded && now - lastMaxWarnTs >= maxValueThrottleMs) {
						adapter.maxValueWarnedAt.set(id, now);
						sendNotification(
							adapter,
							getNotificationMessage(adapter, 'maxValueExceededNoLastValid', {
								name: sensor.SensorName,
								value: numValue,
								maxVal,
							}),
						).catch(() => {});
					}
					return false;
				}
				adapter.log.warn(
					`Sensor "${sensor.SensorName}" delivers implausible value (${numValue} > max ${maxVal}). Using last valid value (${lastValid}) instead.`,
				);
				if (adapter.config.notifyOnMaxValueExceeded && now - lastMaxWarnTs >= maxValueThrottleMs) {
					adapter.maxValueWarnedAt.set(id, now);
					sendNotification(
						adapter,
						getNotificationMessage(adapter, 'maxValueExceeded', {
							name: sensor.SensorName,
							value: numValue,
							maxVal,
							lastValid,
						}),
					).catch(() => {});
				}
				valueToSend = lastValid;
			} else {
				adapter.lastValidValue.set(id, numValue);
			}
		}
	}

	if (sensor.internal) {
		adapter.log.debug(`Skip Influx write for internal sensor: ${id}`);
		return false;
	}

	adapter.log.debug(`Collect point: ${id} : ${valueToSend} to: ${sensor.measurement} : ${sensor.field}`);
	adapter.buffer.push({
		id: sensor.SensorName,
		measurement: sensor.measurement,
		field: sensor.field,
		type: sensor.type,
		value: valueToSend,
		ts,
	});

	if (adapter.buffer.length > adapter.maxBufferSize) {
		adapter.log.warn('Buffer limit reached – dropping oldest entries');
		adapter.buffer.splice(0, adapter.buffer.length - adapter.maxBufferSize);
	}
	return true;
}

/**
 * Writes the value of a "write on change" sensor when its source state changed, with the time of
 * that change (`lc`). A source that repeats the same value (a car polled while it is parked) only
 * moves `ts`, so it adds no point; a repeated event or a restart adds none either.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} id - The sensor state id (sensors.*).
 * @param {{ val: unknown, ts?: number, lc?: number }} state - The source state.
 * @returns {boolean} True when a point was buffered.
 */
function writeSensorChange(adapter, id, state) {
	const sensor = (adapter.config.sensors || []).find(
		s => s && s.enabled && s.writeOnChange && s.type !== 'json' && getSensorStateId(s) === id,
	);
	if (!sensor || !state) {
		return false;
	}
	const now = Date.now();
	const changedAt = [state.lc, state.ts].find(t => typeof t === 'number' && Number.isFinite(t));
	const ts = changedAt !== undefined ? changedAt : now;
	const lastTs = adapter.lastWrittenTs.get(id);
	if (lastTs !== undefined && ts <= lastTs) {
		return false;
	}
	if (!bufferSensorValue(adapter, sensor, id, state.val, ts, now)) {
		return false;
	}
	adapter.lastWrittenTs.set(id, ts);
	saveBuffer(adapter);
	updateBufferStates(adapter);
	if (!adapter.isFlushing) {
		scheduleNextFlush(adapter, 0);
	}
	return true;
}

/**
 * Cancels any pending flush timer and schedules a new flush after the given delay.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {number} delayMs - Delay before the next flush attempt in milliseconds.
 */
function scheduleNextFlush(adapter, delayMs) {
	const delay = clampDelay(delayMs, getFlushIntervalMs(adapter));

	if (adapter.flushTimer) {
		adapter.clearTimeout(adapter.flushTimer);
	}

	adapter.flushTimer = adapter.setTimeout(() => {
		flushBuffer(adapter).catch(() => {});
	}, delay);
}

/**
 * Sends the "connection restored" notification if the adapter was previously disconnected,
 * then clears the disconnected flag and resets the failure counter.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
function handleConnectionRestore(adapter) {
	if (adapter.influxWasDisconnected && adapter.config.notifyOnConnectionFail) {
		sendNotification(adapter, getNotificationMessage(adapter, 'influxConnectionRestored')).catch(() => {});
	}
	adapter.influxWasDisconnected = false;
	adapter.flushFailures = 0;
	adapter.lastConnectionFailNotifyTs = 0;
}

/**
 * Writes the current buffer to InfluxDB. Guards against concurrent flushes and handles
 * connection failures, field-type conflicts, and clean unload mid-flush.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function flushBuffer(adapter) {
	if (adapter.isUnloading) {
		return;
	}

	// Guard against overlapping flushes
	if (adapter.isFlushing) {
		scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
		return;
	}
	adapter.isFlushing = true;

	let batch = null;
	try {
		const influxReady = await ensureInflux(adapter);
		if (!influxReady) {
			handleFlushFailure(adapter);
			return;
		}

		/* --- No active sensors → do not write, but connection is known-good --- */
		if (!hasEnabledSensors(adapter)) {
			adapter.log.debug('Flush skipped: no enabled sensors');
			handleConnectionRestore(adapter);
			adapter.setState('info.connection', true, true);
			scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
			return;
		}

		/* --- Buffer empty → nothing to write, but connection ok --- */
		if (adapter.buffer.length === 0) {
			handleConnectionRestore(adapter);
			adapter.setState('info.connection', true, true);
			scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
			return;
		}

		const writeApi = adapter.writeApi;
		if (!writeApi) {
			// Should not happen if ensureInflux() returned true, but stay safe
			handleFlushFailure(adapter);
			return;
		}

		// Snapshot-and-swap: take current buffer, replace with empty array.
		// Collects during the async flush write to the new empty buffer,
		// so the batch being flushed is never modified concurrently.
		batch = adapter.buffer;
		adapter.buffer = [];

		for (const entry of batch) {
			const point = new Point(entry.measurement).timestamp(entry.ts);
			let fieldValue;

			switch (entry.type) {
				case 'int':
					fieldValue = parseInt(entry.value, 10);
					if (Number.isNaN(fieldValue)) {
						adapter.log.warn(`Skip NaN int value for ${entry.measurement}.${entry.field}`);
						continue;
					}
					point.intField(entry.field, fieldValue);
					break;
				case 'float':
					fieldValue = parseFloat(entry.value);
					if (Number.isNaN(fieldValue)) {
						adapter.log.warn(`Skip NaN float value for ${entry.measurement}.${entry.field}`);
						continue;
					}
					point.floatField(entry.field, fieldValue);
					break;
				case 'bool':
					point.booleanField(entry.field, Boolean(entry.value));
					break;
				default:
					if (entry.value === undefined || entry.value === null) {
						adapter.log.warn(`Skip empty string value for ${entry.measurement}.${entry.field}`);
						continue;
					}
					point.stringField(entry.field, String(entry.value));
			}

			adapter.log.debug(`Write point: ${entry.id} : ${entry.value} to: ${entry.measurement} : ${entry.field}`);
			writeApi.writePoint(point);
		}

		await writeApi.flush();

		// Success: batch is done, save buffer (may contain new entries from concurrent collects)
		saveBuffer(adapter);
		updateBufferStates(adapter);

		// Notify on connection restore after a previous failure
		handleConnectionRestore(adapter);
		adapter.setState('info.connection', true, true);
		scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
	} catch (err) {
		// If adapter is shutting down, just save the batch and bail out
		if (adapter.isUnloading) {
			if (batch) {
				adapter.buffer = batch.concat(adapter.buffer);
				saveBuffer(adapter);
			}
			return;
		}

		adapter.log.error(`Flush failed: ${err.message}`);
		await closeWriteApi(adapter);

		// Merge failed batch back: prepend to current buffer to preserve chronological order
		if (batch) {
			adapter.buffer = batch.concat(adapter.buffer);
		}
		saveBuffer(adapter);
		updateBufferStates(adapter);

		if (isFieldTypeConflict(err)) {
			adapter.log.error('Field type conflict detected – disabling affected sensor');
			await adapter.disableSensorByFieldTypeConflict(err);
			await clearBuffer(adapter);
		}

		handleFlushFailure(adapter);
	} finally {
		adapter.isFlushing = false;
	}
}

/**
 * Increments the flush failure counter, marks the connection as disconnected,
 * and schedules the next retry with an exponential back-off delay.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
function handleFlushFailure(adapter) {
	adapter.flushFailures++;
	adapter.setState('info.connection', false, true);

	const wasDisconnected = !!adapter.influxWasDisconnected;
	adapter.influxWasDisconnected = true;

	// Notify on transition to disconnected state OR when the configured repeat interval has elapsed
	if (adapter.config.notifyOnConnectionFail) {
		const repeatMs = (adapter.config.notifyRepeatMinutes || 60) * 60_000;
		const now = Date.now();
		const lastNotifyTs = adapter.lastConnectionFailNotifyTs || 0;
		if (!wasDisconnected || now - lastNotifyTs >= repeatMs) {
			adapter.lastConnectionFailNotifyTs = now;
			sendNotification(adapter, getNotificationMessage(adapter, 'influxConnectionFailed')).catch(() => {});
		}
	}

	const base = getFlushIntervalMs(adapter);
	const delay = Math.min(base * adapter.flushFailures, adapter.maxFlushInterval);

	adapter.log.warn(`Retry flush in ${Math.round(delay / 1000)}s`);
	scheduleNextFlush(adapter, delay);
}

module.exports = { collectPoints, writeSensorChange, scheduleNextFlush, flushBuffer, handleFlushFailure };
