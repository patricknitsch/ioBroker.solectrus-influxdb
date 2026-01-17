'use strict';

/*
 * Created with @iobroker/create-adapter v3.1.2
 */

const utils = require('@iobroker/adapter-core');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const fs = require('fs');
const path = require('path');

class SolectrusInfluxdb extends utils.Adapter {
	constructor(options) {
		super({
			...options,
			name: 'solectrus-influxdb',
		});

		/* ---------- Influx ---------- */
		this.influx = null;
		this.writeApi = null;

		/* ---------- Runtime ---------- */
		this.cache = {};
		this.buffer = [];
		this.sourceToSensorId = {};

		this.collectTimer = null;
		this.flushTimer = null;

		this.isUnloading = false;

		/* ---------- Retry ---------- */
		this.flushFailures = 0;
		this.maxFlushInterval = 300_000; // 5 min

		/* ---------- Persistence ---------- */
		this.bufferFile = path.join(this.adapterDir, 'buffer.json');

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
	}

	/* =====================================================
	 * HELPERS
	 * ===================================================== */

	getSensorStateId(sensor) {
		return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
	}

	isInfluxReady() {
		return !!this.writeApi && !this.isUnloading;
	}

	getCollectInterval() {
		return Number(this.config.influx?.interval) > 0 ? Number(this.config.influx.interval) * 1000 : 5000;
	}

	getFlushInterval() {
		return Number(this.config.influx?.flushInterval) > 0 ? Number(this.config.influx.flushInterval) * 1000 : 10_000;
	}

	/* =====================================================
	 * BUFFER (PERSISTENT)
	 * ===================================================== */

	async clearBuffer() {
		this.log.info('Clear Buffer...');
		this.buffer = [];
		try {
			this.saveBuffer();
			this.log.info('Buffer successfully cleared');
		} catch (err) {
			this.log.error(`Error at clearing Buffer: ${err.message}`);
		}
		this.updateBufferStates();
		this.log.info('Buffer cleared and State updated.');
	}

	loadBuffer() {
		try {
			if (fs.existsSync(this.bufferFile)) {
				this.buffer = JSON.parse(fs.readFileSync(this.bufferFile, 'utf8')) || [];
				this.log.info(`Loaded ${this.buffer.length} buffered points`);
			}
		} catch (err) {
			this.log.error(`Failed to load buffer: ${err.message}`);
			this.buffer = [];
		}
	}

	saveBuffer() {
		try {
			fs.writeFileSync(this.bufferFile, JSON.stringify(this.buffer));
		} catch (err) {
			this.log.error(`Failed to save buffer: ${err.message}`);
		}
	}

	updateBufferStates() {
		this.setState('info.buffer.size', this.buffer.length, true);
		if (this.buffer.length > 0) {
			this.setState('info.buffer.oldest', new Date(this.buffer[0].ts).toISOString(), true);
		}
	}

	/* =====================================================
	 * READY
	 * ===================================================== */

	async onReady() {
		await this.createInfoStates();

		this.setState('info.connection', false, true);

		this.loadBuffer();
		this.updateBufferStates();

		if (!this.validateInfluxConfig()) {
			this.log.error('InfluxDB configuration incomplete');
			return;
		}

		if (!Array.isArray(this.config.sensors)) {
			this.config.sensors = [];
		}
		await this.prepareSensors();

		/* Collect loop */
		this.collectTimer = setInterval(() => this.collectPoints().catch(() => {}), this.getCollectInterval());

		/* Flush loop – start immediately */
		this.scheduleNextFlush(1000);

		this.log.info('Adapter started successfully');
	}

	async createInfoStates() {
		await this.setObjectNotExistsAsync('info.connection', {
			type: 'state',
			common: {
				name: 'InfluxDB connection',
				type: 'boolean',
				role: 'indicator.connected',
				read: true,
				write: false,
			},
			native: {},
		});

		await this.setObjectNotExistsAsync('info.buffer.size', {
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

		await this.setObjectNotExistsAsync('info.buffer.oldest', {
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

		await this.setObjectNotExistsAsync('info.buffer.clear', {
			type: 'state',
			common: {
				name: 'Buffer manuell löschen',
				type: 'boolean',
				role: 'button',
				read: false,
				write: true,
			},
			native: {},
		});
		this.subscribeStates('info.buffer.clear');
	}

	validateInfluxConfig() {
		const cfg = this.config.influx;
		return cfg && cfg.url?.trim() && cfg.token?.trim() && cfg.org?.trim() && cfg.bucket?.trim();
	}

	/* =====================================================
	 * INFLUX
	 * ===================================================== */

	async prepareInflux() {
		if (this.isInfluxReady()) {
			return;
		}

		const { url, token, org, bucket } = this.config.influx;

		this.influx = new InfluxDB({ url, token });
		this.writeApi = this.influx.getWriteApi(org, bucket, 'ms');
	}

	async closeWriteApi() {
		if (!this.writeApi) {
			return;
		}

		try {
			await this.writeApi.close();
		} catch {
			// ignore
		} finally {
			this.writeApi = null;
			this.influx = null;
		}
	}

	async ensureInflux() {
		if (this.isInfluxReady()) {
			return true;
		}

		try {
			await this.prepareInflux();
			return true;
		} catch (err) {
			this.log.warn(`Influx not reachable: ${err.message}`);
			return false;
		}
	}

	/* =====================================================
	 * SENSORS
	 * ===================================================== */

	async prepareSensors() {
		for (const sensor of this.config.sensors) {
			if (!sensor.enabled) {
				continue;
			}

			const id = this.getSensorStateId(sensor);
			const typeMapping = {
				int: 'number',
				float: 'number',
				bool: 'boolean',
				string: 'string',
			};

			// Use configured type
			const iobType = typeMapping[sensor.type] || 'mixed';

			const obj = await this.getObjectAsync(id);

			/** @type {ioBroker.SettableStateObject} */
			const newObj = {
				type: 'state',
				common: {
					name: sensor.SensorName,
					type: iobType,
					role: 'value',
					read: true,
					write: false,
				},
				native: {
					sourceState: sensor.sourceState,
				},
			};

			if (!obj) {
				this.setObject(id, newObj);
			} else {
				this.extendObject(id, newObj);
			}

			if (!sensor.sourceState) {
				continue;
			}

			const foreignObj = await this.getForeignObjectAsync(sensor.sourceState);
			if (!foreignObj) {
				this.log.warn(`Source state not found: ${sensor.sourceState}`);
				continue;
			}

			this.sourceToSensorId[sensor.sourceState] = id;

			if (sensor.sourceState) {
				const obj = await this.getForeignObjectAsync(sensor.sourceState);
				if (!obj) {
					this.log.warn(`Source state not found: ${sensor.sourceState}`);
					continue;
				}

				const state = await this.getForeignStateAsync(sensor.sourceState);
				if (state) {
					this.cache[id] = state.val;
					this.setState(id, state.val, true);
				}

				this.subscribeForeignStates(sensor.sourceState);
			}
		}
	}

	onStateChange(id, state) {
		if (!state || this.isUnloading) {
			return;
		}
		if (id === `${this.namespace}.info.buffer.clear` && state.val === true) {
			this.log.debug('Trigger clearing Buffer');
			this.clearBuffer();
			this.setState('info.buffer.clear', false, true); // Reset Button
			return;
		}

		const sensorId = this.sourceToSensorId[id];
		if (!sensorId) {
			return;
		}

		this.cache[sensorId] = state.val;
		this.setState(sensorId, state.val, true);
	}

	/* =====================================================
	 * COLLECT
	 * ===================================================== */

	async collectPoints() {
		const now = Date.now();

		for (const sensor of this.config.sensors) {
			if (!sensor.enabled) {
				continue;
			}

			const id = this.getSensorStateId(sensor);
			const value = this.cache[id];

			if (value === undefined || value === null) {
				continue;
			}

			this.buffer.push({
				id: sensor.SensorName,
				measurement: sensor.measurement,
				field: sensor.field,
				type: sensor.type,
				value,
				ts: now,
			});
		}

		this.saveBuffer();
		this.updateBufferStates();
	}

	/* =====================================================
	 * FLUSH
	 * ===================================================== */

	scheduleNextFlush(delay) {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
		}

		this.flushTimer = setTimeout(() => {
			this.flushBuffer().catch(() => {});
		}, delay);
	}

	async flushBuffer() {
		if (this.isUnloading || this.buffer.length === 0) {
			this.scheduleNextFlush(this.getFlushInterval());
			return;
		}

		if (!(await this.ensureInflux())) {
			return this.handleFlushFailure();
		}

		const writeApi = this.writeApi;
		if (!writeApi) {
			return this.handleFlushFailure();
		}

		try {
			for (const entry of this.buffer) {
				const point = new Point(entry.measurement).timestamp(entry.ts);

				switch (entry.type) {
					case 'int':
						point.intField(entry.field, parseInt(entry.value, 10));
						break;
					case 'float':
						point.floatField(entry.field, parseFloat(entry.value));
						break;
					case 'bool':
						point.booleanField(entry.field, Boolean(entry.value));
						break;
					default:
						point.stringField(entry.field, String(entry.value));
				}

				this.log.debug(`Write point: ${entry.id} : ${entry.value} to: ${entry.measurement} : ${entry.field}`);
				writeApi.writePoint(point);
			}

			await writeApi.flush();

			this.buffer = [];
			this.saveBuffer();
			this.updateBufferStates();

			this.flushFailures = 0;
			this.setState('info.connection', true, true);
			this.scheduleNextFlush(this.getFlushInterval());
		} catch (err) {
			this.log.warn(`Flush failed: ${err.message}`);
			await this.closeWriteApi();
			await this.clearBuffer();
			this.handleFlushFailure();
		}
	}

	handleFlushFailure() {
		this.flushFailures++;
		this.setState('info.connection', false, true);

		const delay = Math.min(this.getFlushInterval() * this.flushFailures, this.maxFlushInterval);

		this.log.warn(`Retry flush in ${Math.round(delay / 1000)}s`);
		this.scheduleNextFlush(delay);
	}

	/* =====================================================
	 * UNLOAD
	 * ===================================================== */

	async onUnload(callback) {
		try {
			this.isUnloading = true;

			if (this.collectTimer) {
				clearInterval(this.collectTimer);
			}
			if (this.flushTimer) {
				clearTimeout(this.flushTimer);
			}

			this.saveBuffer();
			await this.closeWriteApi();

			this.setState('info.connection', false, true);
			callback();
		} catch {
			callback();
		}
	}
}

/* =====================================================
 * START
 * ===================================================== */

if (require.main !== module) {
	module.exports = options => new SolectrusInfluxdb(options);
} else {
	(() => new SolectrusInfluxdb())();
}
