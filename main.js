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
		this.influxVerified = false;

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
		this.maxBufferSize = 100_000;

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
	}

	/* =====================================================
	 * HELPERS
	 * ===================================================== */

	parseFieldTypeConflictError(err) {
		if (!err || !err.message) {
			return null;
		}

		const regex = /field type conflict: input field "([^"]+)" on measurement "([^"]+)"/i;
		const match = err.message.match(regex);

		if (!match) {
			return null;
		}

		return {
			field: match[1], // z.B. inverter_power
			measurement: match[2], // z.B. KOSTAL
		};
	}

	isFieldTypeConflict(err) {
		if (!err || !err.message) {
			return false;
		}
		return err.message.toLowerCase().includes('field type conflict');
	}

	getSensorStateId(sensor) {
		return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
	}

	isInfluxReady() {
		return !!this.writeApi && this.influxVerified && !this.isUnloading;
	}

	getCollectInterval() {
		return Number(this.config.influx?.interval) > 0 ? Number(this.config.influx.interval) * 1000 : 5000;
	}

	getFlushInterval() {
		return Number(this.config.influx?.interval) > 0 ? (Number(this.config.influx.interval) + 5) * 1000 : 10_000;
	}

	hasEnabledSensors() {
		return Array.isArray(this.config.sensors) && this.config.sensors.some(s => s.enabled);
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
		this.setState('info.buffer.clear', false, true);
		this.setState('info.lastError', '', true);

		this.loadBuffer();
		this.updateBufferStates();

		if (!this.validateInfluxConfig()) {
			this.log.error('InfluxDB configuration incomplete');
			return;
		}

		/* --- Always check Influx Connection --- */
		const influxOk = await this.verifyInfluxConnection();
		if (!influxOk) {
			this.setState('info.lastError', 'InfluxDB connection failed – check URL, Token, Org and Bucket', true);
			// Adapter run → Retry later during flush
		}

		if (!Array.isArray(this.config.sensors)) {
			this.config.sensors = [];
		}

		await this.ensureSensorTitlesInInstanceConfig();

		if (!this.hasEnabledSensors()) {
			const msg = 'No sensor is enabled. Please activate at least one sensor in the adapter configuration.';
			this.log.warn(msg);
			this.setState('info.lastError', msg, true);
		}

		await this.prepareSensors();

		/* Collect loop */
		this.collectTimer = setInterval(() => this.collectPoints().catch(() => {}), this.getCollectInterval());

		/* Flush loop – start immediately */
		this.scheduleNextFlush(1000);

		this.log.info('Adapter started successfully');
	}

	async ensureSensorTitlesInInstanceConfig() {
		try {
			const objId = `system.adapter.${this.namespace}`;
			const obj = await this.getForeignObjectAsync(objId);
			if (!obj || !obj.native || !Array.isArray(obj.native.sensors)) {
				return;
			}

			let changed = false;
			obj.native.sensors.forEach(sensor => {
				if (!sensor || typeof sensor !== 'object') {
					return;
				}
				const sensorName = sensor.SensorName || 'Sensor';
				const expectedTitle = `${sensor.enabled ? '🟢 ' : '⚪ '}${sensorName}`;
				if (sensor._title !== expectedTitle) {
					sensor._title = expectedTitle;
					changed = true;
				}
			});

			if (changed) {
				await this.setForeignObjectAsync(objId, obj);
			}
		} catch (e) {
			// Not critical for adapter runtime; it only affects nicer admin display.
			this.log.debug(`Cannot migrate sensor titles: ${e}`);
		}
	}

	async createInfoStates() {
		await this.setObjectNotExistsAsync('info.connection', {
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
				name: 'Clear Buffer manually',
				type: 'boolean',
				role: 'button',
				read: false,
				write: true,
			},
			native: {},
		});
		this.subscribeStates('info.buffer.clear');

		await this.setObjectNotExistsAsync('info.lastError', {
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

	/* =====================================================
	 * INFLUX
	 * ===================================================== */

	async verifyInfluxConnection() {
		try {
			const { url, token, org, bucket } = this.config.influx;

			this.influx = new InfluxDB({ url, token });
			this.writeApi = this.influx.getWriteApi(org, bucket, 'ms');

			const testPoint = new Point('adapter_connection_test').booleanField('ok', true).timestamp(new Date());

			this.writeApi.writePoint(testPoint);
			await this.writeApi.flush();

			this.influxVerified = true;
			this.setState('info.connection', true, true);
			this.log.info('InfluxDB connection verified');
			return true;
		} catch (err) {
			this.log.error(`Influx verification failed: ${err.message}`);
			this.influxVerified = false;
			await this.closeWriteApi();
			this.setState('info.connection', false, true);
			return false;
		}
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

	validateInfluxConfig() {
		const cfg = this.config.influx;
		return cfg && cfg.url?.trim() && cfg.token?.trim() && cfg.org?.trim() && cfg.bucket?.trim();
	}

	async ensureInflux() {
		if (this.isInfluxReady()) {
			return true;
		}
		this.log.debug('Verify Influx Connection...');
		return await this.verifyInfluxConnection();
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

	disableSensorByFieldTypeConflict(err) {
		const conflict = this.parseFieldTypeConflictError(err);
		if (!conflict) {
			return;
		}

		const { measurement, field } = conflict;

		const sensor = this.config.sensors.find(s => s.measurement === measurement && s.field === field);

		if (!sensor) {
			this.log.warn(`Kein Sensor für Messung "${measurement}" und Feld "${field}" gefunden.`);
			return;
		}

		sensor.enabled = false;

		const msg = `Sensor "${sensor.SensorName}" was deactivated because of Field-Type-Conflict (Messung: ${measurement}, Feld: ${field})`;
		this.log.error(msg);
		this.setState('info.lastError', msg, true);
	}

	/* =====================================================
	 * STATE CHANGE
	 * ===================================================== */

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

			this.log.debug(`Collect point: ${id} : ${value} to: ${sensor.measurement} : ${sensor.field}`);
			this.buffer.push({
				id: sensor.SensorName,
				measurement: sensor.measurement,
				field: sensor.field,
				type: sensor.type,
				value,
				ts: now,
			});

			if (this.buffer.length > this.maxBufferSize) {
				this.log.warn('Buffer limit reached – dropping oldest entries');
				this.buffer.splice(0, this.buffer.length - this.maxBufferSize);
			}
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
		if (this.isUnloading) {
			return;
		}

		/* --- No active sensors → write nothing --- */
		if (!this.hasEnabledSensors()) {
			this.log.debug('Flush skipped: no enabled sensors');
			this.scheduleNextFlush(this.getFlushInterval());
			return;
		}

		/* --- Check Influx if Sensors active --- */
		const influxReady = await this.ensureInflux();
		if (!influxReady) {
			this.log.warn('Influx not ready');
			return this.handleFlushFailure();
		}

		/* --- Buffer empty → write nothing, Connection ok --- */
		if (this.buffer.length === 0) {
			this.flushFailures = 0;
			this.setState('info.connection', true, true);
			this.scheduleNextFlush(this.getFlushInterval());
			return;
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
			this.log.error(`Flush failed: ${err.message}`);
			await this.closeWriteApi();

			if (this.isFieldTypeConflict(err)) {
				this.log.error('Field type conflict detected – disabling affected sensors');

				this.disableSensorByFieldTypeConflict(err);

				await this.clearBuffer();
			}

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
