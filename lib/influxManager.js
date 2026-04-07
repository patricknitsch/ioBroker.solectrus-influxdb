'use strict';

const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { getInfluxConfig, isInfluxReady } = require('./helpers');

/**
 * Returns true when all required InfluxDB configuration fields are present.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {boolean} True if URL, token, org and bucket are all non-empty.
 */
function validateInfluxConfig(adapter) {
	const cfg = getInfluxConfig(adapter);
	return !!(cfg.url && cfg.token && cfg.org && cfg.bucket);
}

/**
 * Creates the InfluxDB client and write API, then writes a test point to verify the connection.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
async function verifyInfluxConnection(adapter) {
	try {
		const { url, token, org, bucket } = getInfluxConfig(adapter);

		adapter.influx = new InfluxDB({ url, token });
		adapter.writeApi = adapter.influx.getWriteApi(org, bucket, 'ms');

		const testPoint = new Point('adapter_connection_test').booleanField('ok', true).timestamp(new Date());
		adapter.writeApi.writePoint(testPoint);
		await adapter.writeApi.flush();

		adapter.influxVerified = true;
		adapter.setState('info.connection', true, true);
		adapter.log.info('InfluxDB connection verified');
		return true;
	} catch (err) {
		adapter.log.error(`Influx verification failed: ${err.message}`);
		adapter.influxVerified = false;
		await closeWriteApi(adapter);
		adapter.setState('info.connection', false, true);
		return false;
	}
}

/**
 * Closes the InfluxDB write API and nullifies the client references on the adapter.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function closeWriteApi(adapter) {
	if (!adapter.writeApi) {
		return;
	}

	try {
		await adapter.writeApi.close();
	} catch {
		// ignore
	} finally {
		adapter.writeApi = null;
		adapter.influx = null;
	}
}

/**
 * Ensures the InfluxDB connection is ready, re-verifying it if necessary.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {Promise<boolean>} True when the connection is ready for writes.
 */
async function ensureInflux(adapter) {
	if (isInfluxReady(adapter)) {
		return true;
	}
	adapter.log.debug('Verify Influx Connection...');
	return await verifyInfluxConnection(adapter);
}

module.exports = { validateInfluxConfig, verifyInfluxConnection, closeWriteApi, ensureInflux };
