'use strict';

/*
 * Created with @iobroker/create-adapter v3.1.2
 */

const utils = require('@iobroker/adapter-core');
const path = require('node:path');

/* ---------- lib modules ---------- */
const { createDsProxy } = require('./lib/dsProxy');
const { retryOnConnectionError, getSensorStateId, getCollectIntervalMs } = require('./lib/helpers');
const { loadBuffer, saveBuffer, updateBufferStates, clearBuffer } = require('./lib/bufferManager');
const { validateInfluxConfig, verifyInfluxConnection, closeWriteApi } = require('./lib/influxManager');
const { ensureObjectTree, createInfoStates, ensureDefaultSensorsAndTitles } = require('./lib/objectManager');
const { prepareSensors, processJsonSensorData, extractJsonSensorValues, extractJsonSensorValuesAuto, disableSensorByFieldTypeConflict } = require('./lib/sensorManager');
const { prepareForecastSources, processForecastJson } = require('./lib/forecastManager');
const { collectPoints, scheduleNextFlush } = require('./lib/collectFlush');
const dsStateRegistry = require('./lib/data-solectrus/services/stateRegistry');
const dsItemManager = require('./lib/data-solectrus/services/itemManager');
const dsTickRunner = require('./lib/data-solectrus/services/tickRunner');

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
		this.isFlushing = false;
		this.negativeValueWarned = new Set();
		this.lastValidValue = new Map();

		/* ---------- Alive monitoring ---------- */
		// Maps sensor state id → timestamp (ms) of last received value
		this.lastUpdateTs = new Map();
		// Maps sensor state id → timestamp (ms) when last alive warning was logged
		this.aliveWarnedAt = new Map();

		/* ---------- Forecast ---------- */
		// Maps sourceState → array of forecast config entries that use it
		this.forecastSourceMap = {};

		/* ---------- JSON sensors ---------- */
		// Maps sourceState → array of JSON sensor configs (type === 'json')
		this.jsonSourceMap = {};

		/* ---------- Data-SOLECTRUS proxy ---------- */
		this.dsProxy = null; // initialized in onReady if enabled

		/* ---------- Retry ---------- */
		this.flushFailures = 0;
		this.maxFlushInterval = 300_000; // 5 min

		/* ---------- Persistence ---------- */
		this.bufferFile = path.join(this.adapterDir, 'buffer.json');
		this.maxBufferSize = 100_000;

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
	}

	/* =====================================================
	 * READY
	 * ===================================================== */

	async onReady() {
		await retryOnConnectionError(
			this,
			async () => {
				await ensureObjectTree(this);
				await createInfoStates(this);
			},
			'Create adapter objects',
		);

		this.setState('info.connection', false, true);
		this.setState('info.buffer.clear', false, true);
		this.setState('info.lastError', '', true);

		loadBuffer(this);
		updateBufferStates(this);

		if (!validateInfluxConfig(this)) {
			this.log.error('InfluxDB configuration incomplete');
			this.setState('info.lastError', 'InfluxDB configuration incomplete (URL/Token/Org/Bucket missing)', true);
			return;
		}

		/* --- Always check Influx Connection once at startup --- */
		const influxOk = await verifyInfluxConnection(this);
		if (!influxOk) {
			this.setState('info.lastError', 'InfluxDB connection failed – check URL, Token, Org and Bucket', true);
			// Adapter continues running; flush loop will retry
		}

		if (this.isUnloading) {
			return;
		}

		if (!Array.isArray(this.config.sensors)) {
			this.config.sensors = [];
		}

		await ensureDefaultSensorsAndTitles(this);

		if (!Array.isArray(this.config.sensors) || !this.config.sensors.some(s => s && s.enabled)) {
			const msg = 'No sensor is enabled. Please activate at least one sensor in the adapter configuration.';
			this.log.warn(msg);
			this.setState('info.lastError', msg, true);
		}

		await retryOnConnectionError(this, () => prepareSensors(this), 'Prepare sensors');
		await retryOnConnectionError(this, () => prepareForecastSources(this), 'Prepare forecast sources');

		if (this.isUnloading) {
			return;
		}

		/* Collect loop */
		const collectMs = getCollectIntervalMs(this);
		this.log.info(`Collect interval: ${Math.round(collectMs / 1000)}s`);
		this.collectTimer = this.setInterval(() => collectPoints(this).catch(() => {}), collectMs);

		/* Flush loop – start immediately */
		scheduleNextFlush(this, 1000);

		/* ---------- Data-SOLECTRUS (optional) ---------- */
		if (this.config.enableDataSolectrus) {
			await this.initDataSolectrus();
		} else {
			this.log.info('Data-SOLECTRUS formula engine is disabled');
		}

		this.log.info('Adapter started successfully');
	}

	/* =====================================================
	 * DATA-SOLECTRUS INTEGRATION
	 * ===================================================== */

	async initDataSolectrus() {
		if (this.isUnloading) {
			return;
		}

		this.log.info('Initializing Data-SOLECTRUS formula engine…');

		const ds = createDsProxy(this);
		this.dsProxy = ds;

		await retryOnConnectionError(
			this,
			async () => {
				// Ensure ds channel hierarchy
				await this.setObjectNotExistsAsync('ds', {
					type: 'channel',
					common: { name: 'Data-SOLECTRUS' },
					native: {},
				});
				await this.setObjectNotExistsAsync('ds.info', {
					type: 'channel',
					common: { name: 'DS Info' },
					native: {},
				});

				await dsStateRegistry.createInfoStates(ds);

				await dsItemManager.ensureItemTitlesInInstanceConfig(ds);
				await dsItemManager.prepareItems(ds);

				this.log.info('Data-SOLECTRUS formula engine started');
				dsTickRunner.scheduleNextTick(ds);
			},
			'Data-SOLECTRUS initialization',
		);
	}

	/* =====================================================
	 * DELEGATED METHODS (called by lib modules via adapter.xxx)
	 * ===================================================== */

	scheduleNextFlush(delayMs) {
		scheduleNextFlush(this, delayMs);
	}

	disableSensorByFieldTypeConflict(err) {
		disableSensorByFieldTypeConflict(this, err);
	}

	/* =====================================================
	 * STATE CHANGE
	 * ===================================================== */

	onStateChange(id, state) {
		if (!state || this.isUnloading) {
			return;
		}

		const isOwn = id.startsWith(`${this.namespace}.`);

		// Own states with ack: still forward if this state is a sensor source
		// (e.g. ds.* states produced by Data-SOLECTRUS used as sensor input)
		if (isOwn && state.ack) {
			const sensorId = this.sourceToSensorId[id];
			if (sensorId) {
				this.cache[sensorId] = state.val;
				this.setState(sensorId, state.val, true);
				// Keep alive timestamp up-to-date for ds.* sensor sources
				this.lastUpdateTs.set(sensorId, typeof state.ts === 'number' ? state.ts : Date.now());
			}
			return;
		}

		// Foreign states: normally only process ack=true
		if (!isOwn && !state.ack) {
			return;
		}

		// Button handling (do NOT rely on state.val)
		if (id === `${this.namespace}.info.buffer.clear`) {
			this.log.info('Manual buffer clear triggered');
			clearBuffer(this).catch(() => {});
			// Optional reset for UI convenience (even though read:false)
			this.setState('info.buffer.clear', false, true);
			return;
		}

		// Foreign sensor updates
		const sensorId = this.sourceToSensorId[id];
		if (sensorId) {
			if (this.jsonSourceMap[id]) {
				// JSON sensors: extract only the relevant fields for each mapping
				const mappings = this.jsonSourceMap[id];
				for (const mapping of mappings) {
					const mId = getSensorStateId({ SensorName: mapping.sensorName });
					let filtered;
					if (mapping.autoDetect) {
						filtered = extractJsonSensorValuesAuto(this, state.val, mapping.tsField);
					} else {
						filtered = extractJsonSensorValues(this, state.val, mapping.tsField, mapping.valField);
					}
					if (filtered) {
						this.setState(mId, filtered, true);
					}
				}
			} else {
				this.cache[sensorId] = state.val;
				this.setState(sensorId, state.val, true);
				// Update alive timestamp for non-JSON sensors
				this.lastUpdateTs.set(sensorId, typeof state.ts === 'number' ? state.ts : Date.now());
			}
		}

		// Forecast JSON source updates (legacy)
		if (this.forecastSourceMap[id]) {
			processForecastJson(this, id, state.val);
		}

		// JSON sensor source updates
		if (this.jsonSourceMap[id]) {
			processJsonSensorData(this, id, state.val);
			// Refresh alive timestamp for each JSON sensor backed by this source
			const tsNow = typeof state.ts === 'number' ? state.ts : Date.now();
			for (const mapping of this.jsonSourceMap[id]) {
				const mId = getSensorStateId({ SensorName: mapping.sensorName });
				this.lastUpdateTs.set(mId, tsNow);
			}
		}

		// Forward to Data-SOLECTRUS cache (if enabled)
		if (this.dsProxy && !isOwn) {
			this.dsProxy.cache.set(id, state.val);
			this.dsProxy.cacheTs.set(id, typeof state.ts === 'number' ? state.ts : Date.now());
		}
	}

	/* =====================================================
	 * MESSAGE (formula preview for Data-SOLECTRUS)
	 * ===================================================== */

	onMessage(obj) {
		try {
			if (!obj || !obj.command) {
				return;
			}
			if (obj.command !== 'evalFormulaPreview') {
				return;
			}
			if (!this.dsProxy) {
				if (obj.callback) {
					this.sendTo(
						obj.from,
						obj.command,
						{ ok: false, error: 'Data-SOLECTRUS is not enabled' },
						obj.callback,
					);
				}
				return;
			}

			const msg = obj.message && typeof obj.message === 'object' ? obj.message : {};
			const expr = msg.expr !== undefined ? String(msg.expr) : '';
			const varsIn = msg.vars && typeof msg.vars === 'object' ? msg.vars : {};

			const safeVars = Object.create(null);
			const keys = Object.keys(varsIn).slice(0, 200);
			for (const kRaw of keys) {
				const k = String(kRaw);
				if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
					continue;
				}
				if (k === '__proto__' || k === 'prototype' || k === 'constructor') {
					continue;
				}
				const v = varsIn[kRaw];
				if (typeof v === 'string') {
					safeVars[k] = v.length > 2000 ? v.slice(0, 2000) : v;
				} else if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) {
					safeVars[k] = v;
				} else {
					try {
						const json = JSON.stringify(v);
						if (json && json.length <= 5000) {
							safeVars[k] = v;
						}
					} catch {
						/* ignore */
					}
				}
			}

			let result;
			try {
				result = this.dsProxy.evalFormula(expr, safeVars);
			} catch (e) {
				if (obj.callback) {
					this.sendTo(obj.from, obj.command, { ok: false, error: e.message || String(e) }, obj.callback);
				}
				return;
			}
			if (obj.callback) {
				this.sendTo(obj.from, obj.command, { ok: true, value: result }, obj.callback);
			}
		} catch (e) {
			try {
				if (obj && obj.callback) {
					this.sendTo(obj.from, obj.command, { ok: false, error: e.message || String(e) }, obj.callback);
				}
			} catch {
				/* ignore */
			}
		}
	}

	/* =====================================================
	 * UNLOAD
	 * ===================================================== */

	async onUnload(callback) {
		try {
			this.isUnloading = true;

			// Clean up Data-SOLECTRUS
			if (this.dsProxy) {
				this.dsProxy.isUnloading = true;
				if (this.dsProxy.tickTimer) {
					this.dsProxy.clearTimeout(this.dsProxy.tickTimer);
					this.dsProxy.tickTimer = null;
				}
			}

			if (this.collectTimer) {
				this.clearInterval(this.collectTimer);
			}
			if (this.flushTimer) {
				this.clearTimeout(this.flushTimer);
			}

			// Wait for an in-progress flush to finish before closing the writeApi
			const maxWait = 5000;
			const waitStart = Date.now();
			while (this.isFlushing && Date.now() - waitStart < maxWait) {
				await new Promise(resolve => this.setTimeout(resolve, 50));
			}

			saveBuffer(this);
			await closeWriteApi(this);

			this.setState('info.connection', false, true);
			callback();
		} catch {
			callback();
		}
	}
}

/* =====================================================
 * START (Compact Mode)
 * ===================================================== */

if (require.main !== module) {
	module.exports = options => new SolectrusInfluxdb(options);
} else {
	(() => new SolectrusInfluxdb())();
}
