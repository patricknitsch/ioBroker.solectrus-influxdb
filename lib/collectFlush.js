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

	for (const sensor of adapter.config.sensors) {
		if (!sensor || !sensor.enabled) {
			continue;
		}

		const id = getSensorStateId(sensor);

		// Check alive timeout (throttle: warn at most once per timeout period per sensor)
		const sensorAliveTimeoutMs = sensor.aliveTimeoutMinutes > 0 ? sensor.aliveTimeoutMinutes * 60_000 : 0;
		if (sensorAliveTimeoutMs > 0) {
			const lastTs = adapter.lastUpdateTs.get(id);
			if (lastTs > 0 && now - lastTs > sensorAliveTimeoutMs) {
				const lastWarnTs = adapter.aliveWarnedAt.get(id) || 0;
				const isZeroMode = adapter.aliveZeroAt.has(id);
				const throttleMs = isZeroMode ? ALIVE_ZERO_RETRY_MS : sensorAliveTimeoutMs;
				if (now - lastWarnTs >= throttleMs) {
					adapter.aliveWarnedAt.set(id, now);
					const lastTsStr = new Date(lastTs).toLocaleString();
					const currentValue = adapter.cache[id];
					if (currentValue === 0 || currentValue === '0') {
						adapter.aliveZeroAt.set(id, now);
						adapter.log.info(
							`Sensor "${sensor.SensorName}": no update since ${lastTsStr} (longer than ${sensor.aliveTimeoutMinutes} minute(s)) – current value is 0, next check in 60 minutes`,
						);
					} else {
						adapter.aliveZeroAt.delete(id);
						const warnMsg = `Sensor "${sensor.SensorName}": no update since ${lastTsStr} (longer than ${sensor.aliveTimeoutMinutes} minute(s))`;
						adapter.log.warn(warnMsg);
						if (adapter.config.notifyOnSensorTimeout) {
							sendNotification(adapter, warnMsg).catch(() => {});
						}
					}
				}
			}
		}

		// JSON sensors are event-driven (written on source state change), not polled
		if (sensor.type === 'json') {
			continue;
		}

		const value = adapter.cache[id];

		if (value === undefined || value === null) {
			continue;
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
			const numValue = sensor.type === 'int' ? parseInt(value, 10) : parseFloat(value);
			if (Number.isFinite(numValue)) {
				if (numValue > maxVal) {
					const lastValid = adapter.lastValidValue.get(id);
					const lastMaxWarnTs = adapter.maxValueWarnedAt.get(id) || 0;
					const maxValueThrottleMs = 60 * 60_000; // notify at most once per hour per sensor
					if (lastValid === undefined) {
						const warnMsg = `Sensor "${sensor.SensorName}" delivers implausible value (${numValue} > max ${maxVal}). No last valid value available, skipping point.`;
						adapter.log.warn(warnMsg);
						if (adapter.config.notifyOnMaxValueExceeded && now - lastMaxWarnTs >= maxValueThrottleMs) {
							adapter.maxValueWarnedAt.set(id, now);
							sendNotification(adapter, warnMsg).catch(() => {});
						}
						continue;
					}
					const warnMsg = `Sensor "${sensor.SensorName}" delivers implausible value (${numValue} > max ${maxVal}). Using last valid value (${lastValid}) instead.`;
					adapter.log.warn(warnMsg);
					if (adapter.config.notifyOnMaxValueExceeded && now - lastMaxWarnTs >= maxValueThrottleMs) {
						adapter.maxValueWarnedAt.set(id, now);
						sendNotification(adapter, warnMsg).catch(() => {});
					}
					valueToSend = lastValid;
				} else {
					adapter.lastValidValue.set(id, numValue);
				}
			}
		}

		adapter.log.debug(`Collect point: ${id} : ${valueToSend} to: ${sensor.measurement} : ${sensor.field}`);
		adapter.buffer.push({
			id: sensor.SensorName,
			measurement: sensor.measurement,
			field: sensor.field,
			type: sensor.type,
			value: valueToSend,
			ts: now,
		});

		if (adapter.buffer.length > adapter.maxBufferSize) {
			adapter.log.warn('Buffer limit reached – dropping oldest entries');
			adapter.buffer.splice(0, adapter.buffer.length - adapter.maxBufferSize);
		}
	}

	saveBuffer(adapter);
	updateBufferStates(adapter);

	// Trigger flush immediately after collect (if not already running)
	if (adapter.buffer.length > 0 && !adapter.isFlushing) {
		scheduleNextFlush(adapter, 0);
	}
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

	const influxReady = await ensureInflux(adapter);
	if (!influxReady) {
		return handleFlushFailure(adapter);
	}

	/* --- No active sensors → do not write, but connection is known-good --- */
	if (!hasEnabledSensors(adapter)) {
		adapter.log.debug('Flush skipped: no enabled sensors');
		adapter.flushFailures = 0;
		adapter.setState('info.connection', true, true);
		scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
		return;
	}

	/* --- Buffer empty → nothing to write, but connection ok --- */
	if (adapter.buffer.length === 0) {
		adapter.flushFailures = 0;
		adapter.setState('info.connection', true, true);
		scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
		return;
	}

	const writeApi = adapter.writeApi;
	if (!writeApi) {
		// Should not happen if ensureInflux() returned true, but stay safe
		return handleFlushFailure(adapter);
	}

	// Snapshot-and-swap: take current buffer, replace with empty array.
	// Collects during the async flush write to the new empty buffer,
	// so the batch being flushed is never modified concurrently.
	const batch = adapter.buffer;
	adapter.buffer = [];
	adapter.isFlushing = true;

	try {
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
		if (adapter.influxWasDisconnected && adapter.config.notifyOnConnectionFail) {
			sendNotification(adapter, 'InfluxDB connection restored').catch(() => {});
		}
		adapter.influxWasDisconnected = false;
		adapter.flushFailures = 0;
		adapter.setState('info.connection', true, true);
		scheduleNextFlush(adapter, getFlushIntervalMs(adapter));
	} catch (err) {
		// If adapter is shutting down, just save the batch and bail out
		if (adapter.isUnloading) {
			adapter.buffer = batch.concat(adapter.buffer);
			saveBuffer(adapter);
			adapter.isFlushing = false;
			return;
		}

		adapter.log.error(`Flush failed: ${err.message}`);
		await closeWriteApi(adapter);

		// Merge failed batch back: prepend to current buffer to preserve chronological order
		adapter.buffer = batch.concat(adapter.buffer);
		saveBuffer(adapter);
		updateBufferStates(adapter);

		if (isFieldTypeConflict(err)) {
			adapter.log.error('Field type conflict detected – disabling affected sensor');
			adapter.disableSensorByFieldTypeConflict(err);
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

	// Notify only on transition to disconnected state
	if (!wasDisconnected && adapter.config.notifyOnConnectionFail) {
		sendNotification(adapter, 'InfluxDB connection failed – check URL, Token, Org and Bucket').catch(() => {});
	}

	const base = getFlushIntervalMs(adapter);
	const delay = Math.min(base * adapter.flushFailures, adapter.maxFlushInterval);

	adapter.log.warn(`Retry flush in ${Math.round(delay / 1000)}s`);
	scheduleNextFlush(adapter, delay);
}

module.exports = { collectPoints, scheduleNextFlush, flushBuffer, handleFlushFailure };
