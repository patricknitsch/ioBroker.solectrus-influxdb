'use strict';

/*
 * Created with @iobroker/create-adapter v3.1.2
 */

const utils = require('@iobroker/adapter-core');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- Data-SOLECTRUS imports ---------- */
const {
	parseExpression,
	normalizeFormulaExpression: normalizeFormulaExpressionImpl,
	analyzeAst: analyzeAstImpl,
	evalFormulaAst: evalFormulaAstImpl,
} = require('./lib/data-solectrus/formula');
const {
	applyJsonPath: applyJsonPathImpl,
	getNumericFromJsonPath: getNumericFromJsonPathImpl,
	getValueFromJsonPath: getValueFromJsonPathImpl,
} = require('./lib/data-solectrus/jsonpath');
const dsStateRegistry = require('./lib/data-solectrus/services/stateRegistry');
const dsItemManager = require('./lib/data-solectrus/services/itemManager');
const dsTickRunner = require('./lib/data-solectrus/services/tickRunner');
const dsEvaluator = require('./lib/data-solectrus/services/evaluator');

const MAX_DELAY_MS = 2_147_483_647; // Node.js timer limit

/* =====================================================
 * Data-SOLECTRUS Adapter Proxy
 *
 * Wraps the real adapter so the data-solectrus service
 * modules can operate with their original property names.
 * Own-state operations (setObjectAsync, setStateAsync, …)
 * transparently prefix IDs with "ds." to avoid conflicts
 * with the InfluxDB sensor states.
 * ===================================================== */
function createDsProxy(adapter) {
	const self = {
		/* ---------- DS-specific state ---------- */
		cache: new Map(),
		cacheTs: new Map(),
		compiledItems: new Map(),
		subscribedIds: new Set(),
		currentSnapshot: null,
		lastGoodValue: new Map(),
		lastGoodTs: new Map(),
		consecutiveErrorCounts: new Map(),
		tickTimer: null,
		itemsConfigSignature: '',
		warnedOnce: new Set(),
		debuggedOnce: new Set(),
		isUnloading: false,

		/* ---------- Constants ---------- */
		MAX_FORMULA_LENGTH: 8000,
		MAX_AST_NODES: 2000,
		MAX_AST_DEPTH: 60,
		MAX_DISCOVERED_STATE_IDS_PER_ITEM: 250,
		MAX_TOTAL_SOURCE_IDS: 5000,
		TICK_TIME_BUDGET_RATIO: 0.8,

		/* ---------- Config proxy ---------- */
		config: new Proxy({}, {
			get(_, prop) {
				switch (prop) {
					case 'items': {
						const its = adapter.config['dsItems'];
						const itsEd = adapter.config['dsItemsEditor'];
						const a = Array.isArray(its) && its.length ? its
							: Array.isArray(itsEd) && itsEd.length ? itsEd : [];
						return a;
					}
					case 'pollIntervalSeconds': return adapter.config.dsPollIntervalSeconds || 5;
					case 'snapshotInputs': return adapter.config.dsSnapshotInputs || false;
					case 'snapshotDelayMs': return adapter.config.dsSnapshotDelayMs || 0;
					case 'errorRetriesBeforeZero': return 3;
					default: return adapter.config[prop];
				}
			},
		}),

		/* ---------- Own-state methods (prefix with ds.) ---------- */
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(`ds.${id}`, obj),
		setObjectAsync: (id, obj) => adapter.setObjectAsync(`ds.${id}`, obj),
		extendObjectAsync: (id, obj) => adapter.extendObjectAsync(`ds.${id}`, obj),
		getObjectAsync: (id) => adapter.getObjectAsync(`ds.${id}`),
		setStateAsync: (id, val, ack) => adapter.setStateAsync(`ds.${id}`, val, ack),
		setState: (id, val, ack) => adapter.setState(`ds.${id}`, val, ack),

		/* ---------- DS-specific methods ---------- */
		warnOnce(key, msg) {
			if (self.warnedOnce.size > 500) self.warnedOnce.clear();
			if (self.warnedOnce.has(key)) return;
			self.warnedOnce.add(key);
			adapter.log.warn(`[DS] ${msg}`);
		},
		debugOnce(key, msg) {
			if (self.debuggedOnce.size > 500) self.debuggedOnce.clear();
			if (self.debuggedOnce.has(key)) return;
			self.debuggedOnce.add(key);
			adapter.log.debug(`[DS] ${msg}`);
		},
		safeNum(val, fallback = 0) {
			const n = Number(val);
			return Number.isFinite(n) ? n : fallback;
		},
		applyJsonPath(obj, jsonPath) {
			return applyJsonPathImpl(obj, jsonPath);
		},
		getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getNumericFromJsonPathImpl(rawValue, jsonPath, {
				safeNum: self.safeNum.bind(self),
				warnOnce: self.warnOnce.bind(self),
				debugOnce: self.debugOnce.bind(self),
				warnKeyPrefix,
			});
		},
		getValueFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getValueFromJsonPathImpl(rawValue, jsonPath, {
				warnOnce: self.warnOnce.bind(self),
				warnKeyPrefix,
			});
		},
		normalizeFormulaExpression(expr) {
			return normalizeFormulaExpressionImpl(expr);
		},
		analyzeAst(ast) {
			return analyzeAstImpl(ast, { maxNodes: self.MAX_AST_NODES, maxDepth: self.MAX_AST_DEPTH });
		},
		evalFormula(expr, vars) {
			const normalized = self.normalizeFormulaExpression(expr);
			if (normalized && normalized.length > self.MAX_FORMULA_LENGTH) {
				throw new Error(`Formula too long (>${self.MAX_FORMULA_LENGTH} chars)`);
			}
			const ast = parseExpression(String(normalized));
			self.analyzeAst(ast);
			return self.evalFormulaAst(ast, vars);
		},
		evalFormulaAst(ast, vars) {
			return evalFormulaAstImpl(ast, vars, self.formulaFunctions);
		},
	};

	// Formula functions need the proxy (for v/s/jp), so create after self exists.
	self.formulaFunctions = dsEvaluator.createFormulaFunctions(self);

	// Return a Proxy that delegates anything not on `self` to the real adapter.
	return new Proxy(self, {
		get(target, prop) {
			if (prop in target) return target[prop];
			const val = adapter[prop];
			if (typeof val === 'function') return val.bind(adapter);
			return val;
		},
		set(target, prop, value) {
			target[prop] = value;
			return true;
		},
	});
}

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
	 * HELPERS
	 * ===================================================== */

	getInfluxConfig() {
		// New top-level config (preferred)
		const url = (this.config.influxUrl || '').trim();
		const org = (this.config.influxOrg || '').trim();
		const bucket = (this.config.influxBucket || '').trim();
		const token = (this.config.influxToken || '').trim();

		return { url, token, org, bucket };
	}

	clampDelay(ms, fallbackMs) {
		let v = Number(ms);
		if (!Number.isFinite(v) || v <= 0) {
			v = fallbackMs;
		}
		if (v > MAX_DELAY_MS) {
			v = MAX_DELAY_MS;
		}
		return v;
	}

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
			field: match[1],
			measurement: match[2],
		};
	}

	isFieldTypeConflict(err) {
		return !!(err && err.message && err.message.toLowerCase().includes('field type conflict'));
	}

	getSensorStateId(sensor) {
		return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
	}

	isInfluxReady() {
		return !!this.writeApi && this.influxVerified && !this.isUnloading;
	}

	getCollectIntervalMs() {
		const sec = Number(this.config.influxInterval);
		const ms = sec > 0 ? sec * 1000 : 5000;
		return this.clampDelay(ms, 5000);
	}

	getFlushIntervalMs() {
		// keep your current logic: flush ~ interval + 5 sec (min 10s)
		const sec = Number(this.config.influxInterval);
		const base = sec > 0 ? (sec + 5) * 1000 : 10_000;
		return this.clampDelay(base, 10_000);
	}

	hasEnabledSensors() {
		return Array.isArray(this.config.sensors) && this.config.sensors.some(s => s && s.enabled);
	}

	/* =====================================================
	 * OBJECT TREE (INTERMEDIATE OBJECTS)
	 * ===================================================== */

	async ensureObjectTree() {
		// info channel
		await this.setObjectNotExistsAsync('info', {
			type: 'channel',
			common: { name: 'Info' },
			native: {},
		});

		// buffer channel
		await this.setObjectNotExistsAsync('info.buffer', {
			type: 'channel',
			common: { name: 'Buffer' },
			native: {},
		});

		// sensors channel
		await this.setObjectNotExistsAsync('sensors', {
			type: 'channel',
			common: { name: 'Sensors' },
			native: {},
		});
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
		} else {
			// optional: clear oldest when empty
			this.setState('info.buffer.oldest', '', true);
		}
	}

	/* =====================================================
	 * READY
	 * ===================================================== */

	async onReady() {
		await this.ensureObjectTree();
		await this.createInfoStates();

		this.setState('info.connection', false, true);
		this.setState('info.buffer.clear', false, true);
		this.setState('info.lastError', '', true);

		this.loadBuffer();
		this.updateBufferStates();

		if (!this.validateInfluxConfig()) {
			this.log.error('InfluxDB configuration incomplete');
			this.setState('info.lastError', 'InfluxDB configuration incomplete (URL/Token/Org/Bucket missing)', true);
			return;
		}

		/* --- Always check Influx Connection once at startup --- */
		const influxOk = await this.verifyInfluxConnection();
		if (!influxOk) {
			this.setState('info.lastError', 'InfluxDB connection failed – check URL, Token, Org and Bucket', true);
			// Adapter continues running; flush loop will retry
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
		const collectMs = this.getCollectIntervalMs();
		this.log.info(`Collect interval: ${Math.round(collectMs / 1000)}s`);
		this.collectTimer = this.setInterval(() => this.collectPoints().catch(() => {}), collectMs);

		/* Flush loop – start immediately */
		this.scheduleNextFlush(1000);

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
		this.log.info('Initializing Data-SOLECTRUS formula engine…');

		const ds = createDsProxy(this);
		this.dsProxy = ds;

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
				await this.setForeignObject(objId, obj);
			}
		} catch (e) {
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

	validateInfluxConfig() {
		const cfg = this.getInfluxConfig();
		return !!(cfg.url && cfg.token && cfg.org && cfg.bucket);
	}

	async verifyInfluxConnection() {
		try {
			const { url, token, org, bucket } = this.getInfluxConfig();

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
			if (!sensor || !sensor.enabled) {
				continue;
			}

			const id = this.getSensorStateId(sensor);

			const typeMapping = {
				int: 'number',
				float: 'number',
				bool: 'boolean',
				string: 'string',
			};

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

			// ds.* states from this adapter may not exist yet (created by initDataSolectrus later)
			const isOwnDsState = sensor.sourceState.startsWith(`${this.namespace}.ds.`);
			const foreignObj = await this.getForeignObjectAsync(sensor.sourceState);
			if (!foreignObj && !isOwnDsState) {
				this.log.warn(`Source state not found: ${sensor.sourceState}`);
				continue;
			}

			this.sourceToSensorId[sensor.sourceState] = id;

			const state = await this.getForeignStateAsync(sensor.sourceState);
			if (state) {
				this.cache[id] = state.val;
				this.setState(id, state.val, true);
			}

			this.subscribeForeignStates(sensor.sourceState);
		}
	}

	disableSensorByFieldTypeConflict(err) {
		const conflict = this.parseFieldTypeConflictError(err);
		if (!conflict) {
			return;
		}

		const { measurement, field } = conflict;
		const sensor = this.config.sensors.find(s => s && s.measurement === measurement && s.field === field);

		if (!sensor) {
			this.log.warn(`No sensor found for measurement "${measurement}" and field "${field}".`);
			return;
		}

		sensor.enabled = false;

		const msg = `Sensor "${sensor.SensorName}" was deactivated because of Field-Type-Conflict (measurement: ${measurement}, field: ${field})`;
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

		const isOwn = id.startsWith(`${this.namespace}.`);

		// Own states with ack: still forward if this state is a sensor source
		// (e.g. ds.* states produced by Data-SOLECTRUS used as sensor input)
		if (isOwn && state.ack) {
			const sensorId = this.sourceToSensorId[id];
			if (sensorId) {
				this.cache[sensorId] = state.val;
				this.setState(sensorId, state.val, true);
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
			this.clearBuffer().catch(() => {});
			// Optional reset for UI convenience (even though read:false)
			this.setState('info.buffer.clear', false, true);
			return;
		}

		// Foreign sensor updates
		const sensorId = this.sourceToSensorId[id];
		if (sensorId) {
			this.cache[sensorId] = state.val;
			this.setState(sensorId, state.val, true);
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
			if (!obj || !obj.command) return;
			if (obj.command !== 'evalFormulaPreview') return;
			if (!this.dsProxy) {
				if (obj.callback) this.sendTo(obj.from, obj.command, { ok: false, error: 'Data-SOLECTRUS is not enabled' }, obj.callback);
				return;
			}

			const msg = obj.message && typeof obj.message === 'object' ? obj.message : {};
			const expr = msg.expr !== undefined ? String(msg.expr) : '';
			const varsIn = msg.vars && typeof msg.vars === 'object' ? msg.vars : {};

			const safeVars = Object.create(null);
			const keys = Object.keys(varsIn).slice(0, 200);
			for (const kRaw of keys) {
				const k = String(kRaw);
				if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
				if (k === '__proto__' || k === 'prototype' || k === 'constructor') continue;
				const v = varsIn[kRaw];
				if (typeof v === 'string') {
					safeVars[k] = v.length > 2000 ? v.slice(0, 2000) : v;
				} else if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) {
					safeVars[k] = v;
				} else {
					try {
						const json = JSON.stringify(v);
						if (json && json.length <= 5000) safeVars[k] = v;
					} catch { /* ignore */ }
				}
			}

			let result;
			try {
				result = this.dsProxy.evalFormula(expr, safeVars);
			} catch (e) {
				if (obj.callback) this.sendTo(obj.from, obj.command, { ok: false, error: e.message || String(e) }, obj.callback);
				return;
			}
			if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true, value: result }, obj.callback);
		} catch (e) {
			try {
				if (obj && obj.callback) this.sendTo(obj.from, obj.command, { ok: false, error: e.message || String(e) }, obj.callback);
			} catch { /* ignore */ }
		}
	}

	/* =====================================================
	 * COLLECT
	 * ===================================================== */

	async collectPoints() {
		const now = Date.now();

		for (const sensor of this.config.sensors) {
			if (!sensor || !sensor.enabled) {
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

	scheduleNextFlush(delayMs) {
		const delay = this.clampDelay(delayMs, this.getFlushIntervalMs());

		if (this.flushTimer) {
			this.clearTimeout(this.flushTimer);
		}

		this.flushTimer = this.setTimeout(() => {
			this.flushBuffer().catch(() => {});
		}, delay);
	}

	async flushBuffer() {
		if (this.isUnloading) {
			return;
		}

		const influxReady = await this.ensureInflux();
		if (!influxReady) {
			return this.handleFlushFailure();
		}

		/* --- No active sensors → do not write, but connection is known-good --- */
		if (!this.hasEnabledSensors()) {
			this.log.debug('Flush skipped: no enabled sensors');
			this.flushFailures = 0;
			this.setState('info.connection', true, true);
			this.scheduleNextFlush(this.getFlushIntervalMs());
			return;
		}

		/* --- Buffer empty → nothing to write, but connection ok --- */
		if (this.buffer.length === 0) {
			this.flushFailures = 0;
			this.setState('info.connection', true, true);
			this.scheduleNextFlush(this.getFlushIntervalMs());
			return;
		}

		const writeApi = this.writeApi;
		if (!writeApi) {
			// Should not happen if ensureInflux() returned true, but stay safe
			return this.handleFlushFailure();
		}

		try {
			for (const entry of this.buffer) {
				const point = new Point(entry.measurement).timestamp(entry.ts);
				let fieldValue;

				switch (entry.type) {
					case 'int':
						fieldValue = parseInt(entry.value, 10);
						if (Number.isNaN(fieldValue)) {
							this.log.warn(`Skip NaN int value for ${entry.measurement}.${entry.field}`);
							continue;
						}
						point.intField(entry.field, fieldValue);
						break;
					case 'float':
						fieldValue = parseFloat(entry.value);
						if (Number.isNaN(fieldValue)) {
							this.log.warn(`Skip NaN float value for ${entry.measurement}.${entry.field}`);
							continue;
						}
						point.floatField(entry.field, fieldValue);
						break;
					case 'bool':
						point.booleanField(entry.field, Boolean(entry.value));
						break;
					default:
						if (entry.value === undefined || entry.value === null) {
							this.log.warn(`Skip empty string value for ${entry.measurement}.${entry.field}`);
							continue;
						}
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
			this.scheduleNextFlush(this.getFlushIntervalMs());
		} catch (err) {
			this.log.error(`Flush failed: ${err.message}`);
			await this.closeWriteApi();

			if (this.isFieldTypeConflict(err)) {
				this.log.error('Field type conflict detected – disabling affected sensor');
				this.disableSensorByFieldTypeConflict(err);
				await this.clearBuffer();
			}

			this.handleFlushFailure();
		}
	}

	handleFlushFailure() {
		this.flushFailures++;
		this.setState('info.connection', false, true);

		const base = this.getFlushIntervalMs();
		const delay = Math.min(base * this.flushFailures, this.maxFlushInterval);

		this.log.warn(`Retry flush in ${Math.round(delay / 1000)}s`);
		this.scheduleNextFlush(delay);
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
					clearTimeout(this.dsProxy.tickTimer);
					this.dsProxy.tickTimer = null;
				}
			}

			if (this.collectTimer) {
				this.clearInterval(this.collectTimer);
			}
			if (this.flushTimer) {
				this.clearTimeout(this.flushTimer);
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
 * START (Compact Mode)
 * ===================================================== */

if (require.main !== module) {
	module.exports = options => new SolectrusInfluxdb(options);
} else {
	(() => new SolectrusInfluxdb())();
}
