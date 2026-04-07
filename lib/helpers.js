'use strict';

const { MAX_DELAY_MS } = require('./constants');

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

function parseTimestamp(rawTs) {
	if (typeof rawTs === 'number') {
		return rawTs < 1e12 ? rawTs * 1000 : rawTs;
	}
	return new Date(rawTs).getTime();
}

function parseInfluxValue(rawVal, influxType) {
	return influxType === 'int' ? parseInt(rawVal, 10) : parseFloat(rawVal);
}

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

function isFieldTypeConflict(err) {
	return !!(err && err.message && err.message.toLowerCase().includes('field type conflict'));
}

function getSensorStateId(sensor) {
	return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function getForecastStateId(fc) {
	return `forecasts.${(fc.name || 'forecast').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function isInfluxReady(adapter) {
	return !!adapter.writeApi && adapter.influxVerified && !adapter.isUnloading;
}

function getCollectIntervalMs(adapter) {
	const sec = Number(adapter.config.influxInterval);
	const ms = sec > 0 ? sec * 1000 : 5000;
	return clampDelay(ms, 5000);
}

function getFlushIntervalMs(adapter) {
	// Fallback interval used for retries and safety-net scheduling.
	// Normal flushes are triggered directly by collectPoints().
	const sec = Number(adapter.config.influxInterval);
	const base = sec > 0 ? sec * 1000 : 5000;
	return clampDelay(base, 5000);
}

function hasEnabledSensors(adapter) {
	return Array.isArray(adapter.config.sensors) && adapter.config.sensors.some(s => s && s.enabled);
}

function getInfluxConfig(adapter) {
	// New top-level config (preferred)
	const url = (adapter.config.influxUrl || '').trim();
	const org = (adapter.config.influxOrg || '').trim();
	const bucket = (adapter.config.influxBucket || '').trim();
	const token = (adapter.config.influxToken || '').trim();

	return { url, token, org, bucket };
}

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
