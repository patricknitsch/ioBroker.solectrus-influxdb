'use strict';

const { MAX_DELAY_MS } = require('./constants');

/**
 * Clamps a delay value to a valid range, falling back to a default when the value is invalid.
 *
 * @param {unknown} ms - Requested delay in milliseconds.
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
 * @param {unknown} rawVal - The raw value to parse.
 * @param {string} influxType - InfluxDB field type ('int' or 'float').
 * @returns {number} Parsed numeric value.
 */
function parseInfluxValue(rawVal, influxType) {
	const str = String(rawVal);
	return influxType === 'int' ? parseInt(str, 10) : parseFloat(str);
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
	return `sensors.${String(sensor.SensorName || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')}`;
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
	return getCollectIntervalMs(adapter);
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
 * @param {() => Promise<unknown>} fn - Async function to execute.
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

/** Minimum ioBroker.admin version required by this adapter's jsonConfig "custom" UI (guiApi: 2). */
const MIN_ADMIN_VERSION = '8.0.0';

/**
 * Compares two dot-separated version strings numerically (ignoring any `-prerelease` suffix).
 *
 * @param {string} a - First version, e.g. "8.0.1-alpha.2".
 * @param {string} b - Second version, e.g. "8.0.0".
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal.
 */
function compareVersions(a, b) {
	const parse = v =>
		String(v || '')
			.split('-')[0]
			.split('.')
			.map(n => parseInt(n, 10));
	const pa = parse(a);
	const pb = parse(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const da = Number.isFinite(pa[i]) ? pa[i] : 0;
		const db = Number.isFinite(pb[i]) ? pb[i] : 0;
		if (da !== db) {
			return da - db;
		}
	}
	return 0;
}

/**
 * Checks the installed ioBroker.admin version(s) and logs a prominent, actionable warning
 * (and sets `info.lastError`) if any are below the minimum this adapter's UI requires.
 *
 * Since v2.0.0 the Sensors/Data Values/Backup tabs use Admin 8's "GUI API generation 2"
 * (@iobroker/gui-components), which Admin 6/7 cannot load at all - `globalDependencies` in
 * io-package.json already blocks the update button in Admin's own UI, but this catches the
 * case where the adapter got updated another way (CLI, forced install) and makes the problem
 * immediately visible instead of a silent/confusing failure in the config dialog.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {Promise<void>} Resolves once the check has run.
 */
async function checkAdminVersionCompatibility(adapter) {
	let adminObjects;
	try {
		adminObjects = await adapter.getForeignObjectsAsync('system.adapter.admin.*', 'instance');
	} catch (err) {
		adapter.log.debug(`Could not check installed ioBroker.admin version: ${err.message}`);
		return;
	}

	const outdated = Object.values(adminObjects || {})
		.map(obj => obj && obj.common && obj.common.version)
		.filter(version => typeof version === 'string' && version)
		.filter(version => compareVersions(version, MIN_ADMIN_VERSION) < 0);

	if (!outdated.length) {
		return;
	}

	const msg = `ioBroker.admin ${MIN_ADMIN_VERSION}+ is required for the Sensors, Data Values and Backup tabs to work (found: ${outdated.join(', ')}). Please update ioBroker.admin to version 8 or newer - until then those configuration tabs will not load.`;
	adapter.log.error(msg);
	adapter.setState('info.lastError', msg, true);
}

module.exports = {
	checkAdminVersionCompatibility,
	clampDelay,
	parseJsonArray,
	parseTimestamp,
	parseInfluxValue,
	parseFieldTypeConflictError,
	isFieldTypeConflict,
	getSensorStateId,
	isInfluxReady,
	getCollectIntervalMs,
	getFlushIntervalMs,
	hasEnabledSensors,
	getInfluxConfig,
	retryOnConnectionError,
};
