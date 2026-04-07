'use strict';

const { MAX_DELAY_MS } = require('./constants');

/**
 * Clamps a delay value to a valid range, falling back to a default when the value is invalid.
 *
 * @param {*} ms - Requested delay in milliseconds.
 * @param {number} fallbackMs - Fallback value when ms is not a finite non-negative number.
 * @returns {number} Clamped delay in milliseconds.
 */
function clampDelay(ms, fallbackMs) {
	let v = Number(ms);
	if (!Number.isFinite(v) || v < 0) {
		v = fallbackMs;
	}
	if (v > MAX_DELAY_MS) {
		v = MAX_DELAY_MS;
	}
	return v;
}

/**
 * Parses a JSON string or value and validates that the result is an array.
 *
 * @param {object} adapter - The ioBroker adapter instance (used for logging).
 * @param {string|Array} jsonVal - The raw JSON value to parse.
 * @param {string} sourceLabel - Label used in warning messages to identify the data source.
 * @param {boolean} [silent] - When true, suppresses warning log messages.
 * @returns {Array|null} Parsed array or null on failure.
 */
function parseJsonArray(adapter, jsonVal, sourceLabel, silent) {
	let data;
	try {
		data = typeof jsonVal === 'string' ? JSON.parse(jsonVal) : jsonVal;
	} catch (err) {
		if (!silent) {
			adapter.log.warn(`Failed to parse JSON from ${sourceLabel}: ${err.message}`);
		}
		return null;
	}
	if (!Array.isArray(data)) {
		if (!silent) {
			adapter.log.warn(`Expected JSON array from ${sourceLabel}, got ${typeof data}`);
		}
		return null;
	}
	return data;
}

/**
 * Parses a raw timestamp value into a Unix timestamp in milliseconds.
 *
 * @param {number|string} rawTs - Raw timestamp (number in seconds or milliseconds, or ISO string).
 * @returns {number} Unix timestamp in milliseconds.
 */
function parseTimestamp(rawTs) {
	if (typeof rawTs === 'number') {
		return rawTs < 1e12 ? rawTs * 1000 : rawTs;
	}
	return new Date(rawTs).getTime();
}

/**
 * Parses a raw value to the numeric type expected by InfluxDB.
 *
 * @param {*} rawVal - The raw value to parse.
 * @param {string} influxType - InfluxDB field type ('int' or 'float').
 * @returns {number} Parsed numeric value.
 */
function parseInfluxValue(rawVal, influxType) {
	return influxType === 'int' ? parseInt(rawVal, 10) : parseFloat(rawVal);
}

/**
 * Extracts the measurement and field names from an InfluxDB field-type-conflict error message.
 *
 * @param {Error|null} err - The error object to parse.
 * @returns {{field: string, measurement: string}|null} Parsed conflict info or null if not a conflict error.
 */
function parseFieldTypeConflictError(err) {
	if (!err || !err.message) {
		return null;
	}

	const regex = /field type conflict: input field "([^"]+)" on measurement "([^"]+)"/i;
	const match = err.message.match(regex);

	if (!match) {
		return null;
	}

	return {
		field: match[1],
		measurement: match[2],
	};
}

/**
 * Returns true when the error message indicates an InfluxDB field-type conflict.
 *
 * @param {Error|null} err - The error to inspect.
 * @returns {boolean} True if the error is a field-type conflict.
 */
function isFieldTypeConflict(err) {
	return !!(err && err.message && err.message.toLowerCase().includes('field type conflict'));
}

/**
 * Returns the ioBroker state ID used to mirror a sensor's source value.
 *
 * @param {object} sensor - Sensor configuration object.
 * @returns {string} State ID in the form `sensors.<normalized_name>`.
 */
function getSensorStateId(sensor) {
	return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/**
 * Returns the ioBroker channel ID used for a forecast entry.
 *
 * @param {object} fc - Forecast configuration object.
 * @returns {string} Channel ID in the form `forecasts.<normalized_name>`.
 */
function getForecastStateId(fc) {
	return `forecasts.${(fc.name || 'forecast').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/**
 * Returns true when the InfluxDB write API is initialised, verified, and the adapter is not unloading.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {boolean} True if InfluxDB is ready for writes.
 */
function isInfluxReady(adapter) {
	return !!adapter.writeApi && adapter.influxVerified && !adapter.isUnloading;
}

/**
 * Returns the sensor collect interval in milliseconds derived from the adapter configuration.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {number} Collect interval in milliseconds.
 */
function getCollectIntervalMs(adapter) {
	const sec = Number(adapter.config.influxInterval);
	const ms = sec > 0 ? sec * 1000 : 5000;
	return clampDelay(ms, 5000);
}

/**
 * Returns the flush retry interval in milliseconds derived from the adapter configuration.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {number} Flush interval in milliseconds.
 */
function getFlushIntervalMs(adapter) {
	// Fallback interval used for retries and safety-net scheduling.
	// Normal flushes are triggered directly by collectPoints().
	const sec = Number(adapter.config.influxInterval);
	const base = sec > 0 ? sec * 1000 : 5000;
	return clampDelay(base, 5000);
}

/**
 * Returns true when at least one sensor in the adapter configuration is enabled.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {boolean} True if there is at least one enabled sensor.
 */
function hasEnabledSensors(adapter) {
	return Array.isArray(adapter.config.sensors) && adapter.config.sensors.some(s => s && s.enabled);
}

/**
 * Reads the InfluxDB connection parameters from the adapter configuration.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {{url: string, token: string, org: string, bucket: string}} InfluxDB connection config.
 */
function getInfluxConfig(adapter) {
	// New top-level config (preferred)
	const url = (adapter.config.influxUrl || '').trim();
	const org = (adapter.config.influxOrg || '').trim();
	const bucket = (adapter.config.influxBucket || '').trim();
	const token = (adapter.config.influxToken || '').trim();

	return { url, token, org, bucket };
}

/**
 * Calls an async function with automatic retry on transient InfluxDB connection errors.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {Function} fn - Async function to execute.
 * @param {string} label - Human-readable label used in log messages.
 * @param {number} [maxRetries] - Maximum number of attempts.
 * @param {number} [delayMs] - Delay between retries in milliseconds.
 */
async function retryOnConnectionError(adapter, fn, label, maxRetries = 3, delayMs = 3000) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		if (adapter.isUnloading) {
			return;
		}
		try {
			await fn();
			return;
		} catch (err) {
			const isConnectionError = err && err.message && /connection is closed|db closed/i.test(err.message);
			if (isConnectionError && attempt < maxRetries && !adapter.isUnloading) {
				adapter.log.warn(
					`${label} failed (attempt ${attempt}/${maxRetries}): ${err.message} – retrying in ${Math.round(delayMs / 1000)}s`,
				);
				await new Promise(resolve => adapter.setTimeout(resolve, delayMs));
			} else {
				adapter.log.error(`${label} failed: ${err.message}`);
				return;
			}
		}
	}
}

module.exports = {
	clampDelay,
	parseJsonArray,
	parseTimestamp,
	parseInfluxValue,
	parseFieldTypeConflictError,
	isFieldTypeConflict,
	getSensorStateId,
	getForecastStateId,
	isInfluxReady,
	getCollectIntervalMs,
	getFlushIntervalMs,
	hasEnabledSensors,
	getInfluxConfig,
	retryOnConnectionError,
};
