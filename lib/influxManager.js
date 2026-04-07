'use strict';

const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { getInfluxConfig, isInfluxReady } = require('./helpers');

function validateInfluxConfig(adapter) {
	const cfg = getInfluxConfig(adapter);
	return !!(cfg.url && cfg.token && cfg.org && cfg.bucket);
}

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

async function ensureInflux(adapter) {
	if (isInfluxReady(adapter)) {
		return true;
	}
	adapter.log.debug('Verify Influx Connection...');
	return await verifyInfluxConnection(adapter);
}

module.exports = { validateInfluxConfig, verifyInfluxConnection, closeWriteApi, ensureInflux };
