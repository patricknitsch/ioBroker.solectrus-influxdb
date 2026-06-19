'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');

const COLOR_GREEN  = '#388e3c'; // normal / influx
const COLOR_YELLOW = '#fdd835'; // internal sensor
const COLOR_ORANGE = '#e67e22'; // timeout (alive stale)
const COLOR_RED    = '#e53935'; // max value exceeded

function makeIcon(color) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="0" y="0" width="32" height="32" fill="${color}" rx="4"/></svg>`;
	return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const TRUNCATE_JSON = 60;

/* ── Helpers ── */
function sensorStateId(adapter, sensor) {
	const name = (sensor.SensorName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
	return `${adapter.namespace}.sensors.${name}`;
}

function sensorRelId(sensor) {
	const name = (sensor.SensorName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
	return `sensors.${name}`;
}

function dsItemStateId(adapter, item) {
	const group = (item.group || '').trim();
	const tid   = (item.targetId || '').trim();
	if (!tid) return null;
	return `${adapter.namespace}.ds.${group ? group + '.' + tid : tid}`;
}

function fmtVal(val) {
	if (val === null || val === undefined) return '–';
	if (typeof val === 'number') return isFinite(val) ? String(val) : '–';
	return String(val);
}

/* For JSON sensors: show only the first array/object element (mirrors tab.html fmtSensorVal) */
function fmtJsonVal(val) {
	if (val === null || val === undefined) return '–';
	let parsed = val;
	if (typeof val === 'string') {
		try { parsed = JSON.parse(val); } catch (_) { return String(val).slice(0, TRUNCATE_JSON); }
	}
	if (Array.isArray(parsed)) {
		if (parsed.length === 0) return '[]';
		const s = JSON.stringify(parsed[0]);
		return s.length > TRUNCATE_JSON ? s.slice(0, TRUNCATE_JSON) + '…' : s;
	}
	if (typeof parsed === 'object') {
		const s = JSON.stringify(parsed);
		return s.length > TRUNCATE_JSON ? s.slice(0, TRUNCATE_JSON) + '…' : s;
	}
	return String(parsed);
}

/* ── Device Manager ── */
class SolectrusDeviceManagement extends DeviceManagement {

	constructor(adapter) {
		super(adapter); // communicationState is created lazily in _initCommState (DB must be connected)
		this._sensorByStateId = new Map(); // fullStateId → sensor config
		this._dsItemByStateId = new Map(); // fullStateId → ds item config
	}

	/* ── Build DeviceInfo for a sensor ── */
	async _buildSensorDevice(sensor, state) {
		const stateId    = sensorStateId(this.adapter, sensor);
		const isInternal = !!sensor.internal;
		const isNumeric  = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
		const isJson     = sensor.type === 'json';
		const unit       = sensor.unit || (isNumeric ? 'W' : '');
		const maxVal     = sensor.maxValue > 0 ? sensor.maxValue : null;
		const aliveMs    = sensor.aliveTimeoutMinutes > 0 ? sensor.aliveTimeoutMinutes * 60000 : null;

		if (!state) {
			state = await this.adapter.getForeignStateAsync(stateId).catch(() => null);
		}

		const numVal   = state && typeof state.val === 'number' ? state.val : null;
		const isMaxExc = maxVal !== null && numVal !== null && numVal > maxVal;

		const rawVal     = state ? state.val : null;
		const valStr     = isJson ? fmtJsonVal(rawVal) : fmtVal(rawVal);

		/* Use lastUpdateTs for accurate source timestamp (set from original foreign state.ts) */
		const relId  = sensorRelId(sensor);
		const lastTs = (this.adapter.lastUpdateTs instanceof Map && this.adapter.lastUpdateTs.get(relId))
			|| (state && state.ts)
			|| 0;

		/* Extend alive timeout to 60 min for zero values – mirrors tab.html logic */
		const isZeroVal     = state && (state.val === 0 || state.val === '0');
		const effectAliveMs = (aliveMs && isZeroVal) ? 60 * 60000 : aliveMs;
		const isAliveStale  = effectAliveMs ? (Date.now() - lastTs) > effectAliveMs && lastTs > 0 : false;

		/* Icon + value color: red > orange > yellow > green */
		const iconColor  = isMaxExc ? COLOR_RED : isAliveStale ? COLOR_ORANGE : isInternal ? COLOR_YELLOW : COLOR_GREEN;
		const valueColor = iconColor;
		const valDisplay = unit ? `${valStr} ${unit}` : valStr;

		/* Zeitstempel = last received time; Timeout = last received + timeout (= deadline) */
		const tsDisplay  = lastTs ? new Date(lastTs).toLocaleString() : '–';
		const nextUpdate = (aliveMs && lastTs) ? new Date(lastTs + effectAliveMs).toLocaleString() : null;

		const customItems = {
			value: {
				type:       'staticInfo',
				label:      { en: 'Value:', de: 'Wert:' },
				data:       valDisplay,
				styleLabel: { fontWeight: 'bold' },
				styleValue: { color: valueColor, fontWeight: 'bold', fontSize: '1.3em' },
			},
		};

		if (maxVal !== null) {
			customItems.maxval = {
				type:       'staticInfo',
				label:      { en: 'Max Value:', de: 'Max-Wert:' },
				data:       `${maxVal}${unit ? ' ' + unit : ''}`,
				styleLabel: { fontWeight: 'bold' },
				styleValue: isMaxExc ? { color: COLOR_RED } : {},
			};
		}

		if (lastTs) {
			customItems.timestamp = {
				type:       'staticInfo',
				label:      { en: 'Timestamp:', de: 'Zeitstempel:' },
				data:       tsDisplay,
				styleLabel: { fontWeight: 'bold' },
				styleValue: isAliveStale ? { color: COLOR_ORANGE } : {},
			};
		}

		if (nextUpdate !== null) {
			customItems.lastValue = {
				type:       'staticInfo',
				label:      { en: 'Timeout:', de: 'Timeout:' },
				data:       nextUpdate,
				styleLabel: { fontWeight: 'bold' },
				styleValue: isAliveStale ? { color: COLOR_ORANGE } : {},
			};
		}

		return {
			id:              { sensor: sensor.SensorName },
			name:            sensor.SensorName.toUpperCase(),
			icon:            makeIcon(iconColor),
			hasDetails:      true,
			color:           '#ffffff',
			backgroundColor: isInternal ? COLOR_YELLOW : COLOR_GREEN,
			customInfo: {
				id:     { sensor: sensor.SensorName },
				schema: { type: 'panel', items: customItems },
			},
			group: {
				key:  sensor.group || 'default-solectrus',
				name: sensor.group || { en: 'Default SOLECTRUS Sensors', de: 'Standard SOLECTRUS-Sensoren' },
			},
		};
	}

	/* ── Build DeviceInfo for a DS formula item ── */
	async _buildDsDevice(item, state) {
		const stateId = dsItemStateId(this.adapter, item);

		if (!state && stateId) {
			state = await this.adapter.getForeignStateAsync(stateId).catch(() => null);
		}

		/* Unit: prefer config, fall back to state object's common.unit, default to 'W' */
		let unit = (item.unit || '').trim();
		if (!unit && stateId) {
			const obj = await this.adapter.getForeignObjectAsync(stateId).catch(() => null);
			unit = (obj && obj.common && obj.common.unit) || '';
		}
		if (!unit) unit = 'W';

		const valStr     = fmtVal(state ? state.val : null);
		const valDisplay = unit ? `${valStr} ${unit}` : valStr;
		const tsDisplay  = state && state.ts ? new Date(state.ts).toLocaleString() : '–';

		return {
			id:              { ds: item.targetId, group: item.group || '' },
			name:            (item.name || item.targetId).toUpperCase(),
			icon:            makeIcon(COLOR_GREEN),
			hasDetails:      true,
			color:           '#ffffff',
			backgroundColor: COLOR_GREEN,
			customInfo: {
				id:     { ds: item.targetId, group: item.group || '' },
				schema: {
					type:  'panel',
					items: {
						value: {
							type:       'staticInfo',
							label:      { en: 'Value:', de: 'Wert:' },
							data:       valDisplay,
							styleLabel: { fontWeight: 'bold' },
							styleValue: { color: '#388e3c', fontWeight: 'bold', fontSize: '1.3em' },
						},
						timestamp: {
							type:       'staticInfo',
							label:      { en: 'Timestamp:', de: 'Zeitstempel:' },
							data:       tsDisplay,
							styleLabel: { fontWeight: 'bold' },
						},
					},
				},
			},
			group: {
				key:  'ds-' + (item.group || 'default'),
				name: item.group
					? { en: `Formula Engine – ${item.group}`, de: `Formel-Engine – ${item.group}` }
					: { en: 'Formula Engine (Data-SOLECTRUS)', de: 'Formel-Engine (Data-SOLECTRUS)' },
			},
		};
	}

	/* ── Lazy communication state + early map population ── */
	async _initCommState() {
		if (this.communicationStateId) return;
		this.communicationStateId = 'info.deviceManager';
		/* Populate maps synchronously (before any await) so notifyStateChange works as soon
		   as the first foreign state arrives – avoids a race with prepareSensors subscriptions */
		this._populateMaps();
		await this.adapter.setObjectNotExistsAsync('info.deviceManager', {
			type:   'state',
			common: {
				expert: true,
				name:   'Communication with GUI for device manager',
				type:   'string',
				role:   'state',
				def:    '',
				read:   true,
				write:  false,
			},
			native: {},
		}).catch(() => {});
	}

	/* ── Fill lookup maps from config without fetching state values ── */
	_populateMaps() {
		const config  = this.adapter.config;
		const sensors = (config.sensors || []).filter(s => s && s.enabled && s.SensorName);
		const dsItems = config.enableDataSolectrus
			? (config.dsItems || []).filter(it => it && it.enabled && it.targetId)
			: [];

		this._sensorByStateId.clear();
		this._dsItemByStateId.clear();

		for (const sensor of sensors) {
			this._sensorByStateId.set(sensorStateId(this.adapter, sensor), sensor);
		}
		for (const item of dsItems) {
			const sid = dsItemStateId(this.adapter, item);
			if (sid) this._dsItemByStateId.set(sid, item);
		}
	}

	/* ── Load all devices ── */
	async loadDevices(context) {
		await this._initCommState();

		const config = this.adapter.config;

		const sensors = (config.sensors || []).filter(s => s && s.enabled && s.SensorName);
		const dsItems = config.enableDataSolectrus
			? (config.dsItems || []).filter(it => it && it.enabled && it.targetId)
			: [];

		context.setTotalDevices(sensors.length + dsItems.length);

		/* Re-populate maps (config may have changed since _initCommState) */
		this._sensorByStateId.clear();
		this._dsItemByStateId.clear();

		for (const sensor of sensors) {
			const sid = sensorStateId(this.adapter, sensor);
			this._sensorByStateId.set(sid, sensor);
			context.addDevice(await this._buildSensorDevice(sensor, null));
		}

		for (const item of dsItems) {
			const sid = dsItemStateId(this.adapter, item);
			if (!sid) continue;
			this._dsItemByStateId.set(sid, item);
			context.addDevice(await this._buildDsDevice(item, null));
		}
	}

	/* ── Push real-time update to GUI when a state changes ── */
	async notifyStateChange(fullId, state) {
		try {
			const sensor = this._sensorByStateId.get(fullId);
			if (sensor) {
				const device = await this._buildSensorDevice(sensor, state);
				await this.sendCommandToGui({ command: 'infoUpdate', deviceId: device.id, info: device });
			}

			const item = this._dsItemByStateId.get(fullId);
			if (item) {
				const device = await this._buildDsDevice(item, state);
				await this.sendCommandToGui({ command: 'infoUpdate', deviceId: device.id, info: device });
			}
		} catch {
			/* DM page may not be open – ignore silently */
		}
	}

	/* ── Override so infoUpdate works without re-fetching from GUI ── */
	async getDeviceInfo(deviceId) {
		const config = this.adapter.config;
		if (deviceId.sensor) {
			const sensor = (config.sensors || []).find(s => s.SensorName === deviceId.sensor);
			if (sensor) return this._buildSensorDevice(sensor, null);
		}
		if (deviceId.ds) {
			const item = (config.dsItems || []).find(
				it => it.targetId === deviceId.ds && (it.group || '') === (deviceId.group || ''),
			);
			if (item) return this._buildDsDevice(item, null);
		}
		return { id: deviceId, name: JSON.stringify(deviceId), hasDetails: false };
	}

	/* ── Device details (expandable "More" panel) ── */
	async getDeviceDetails(deviceId) {
		const config = this.adapter.config;

		if (deviceId.sensor) {
			const sensor = (config.sensors || []).find(s => s.SensorName === deviceId.sensor);
			if (!sensor) return { id: deviceId, schema: { type: 'panel', items: {} } };

			return {
				id:     deviceId,
				schema: {
					type:  'panel',
					items: {
						type: {
							type:  'staticInfo',
							label: { en: 'Type', de: 'Typ' },
							data:  sensor.type || '',
						},
						measurement: {
							type:  'staticInfo',
							label: 'Measurement',
							data:  sensor.measurement || '',
						},
						field: {
							type:  'staticInfo',
							label: 'Field',
							data:  sensor.field || '',
						},
						sourceState: {
							type:       'staticInfo',
							label:      { en: 'Source State', de: 'Quell-State' },
							data:       sensor.sourceState || '',
							styleValue: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
						},
					},
				},
			};
		}

		if (deviceId.ds) {
			const item = (config.dsItems || []).find(
				it => it.targetId === deviceId.ds && (it.group || '') === (deviceId.group || ''),
			);
			if (!item) return { id: deviceId, schema: { type: 'panel', items: {} } };

			const stateId = dsItemStateId(this.adapter, item);
			const mode    = item.mode || 'formula';
			let   expr    = '';
			if (mode === 'formula')                               expr = item.formula || '';
			else if (mode === 'source' || mode === 'sourceState') expr = item.sourceState || '';
			else if (mode === 'jsonPath')                         expr = (item.sourceState || '') + (item.jsonPath ? ' → ' + item.jsonPath : '');
			else if (mode === 'state-machine')                    expr = '[state-machine]';

			return {
				id:     deviceId,
				schema: {
					type:  'panel',
					items: {
						mode: {
							type:  'staticInfo',
							label: { en: 'Mode', de: 'Modus' },
							data:  mode,
						},
						formula: {
							type:       'staticInfo',
							label:      { en: 'Formula / Expression', de: 'Formel / Ausdruck' },
							data:       expr,
							styleValue: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
						},
						stateId: {
							type:       'staticInfo',
							label:      'State ID',
							data:       stateId || '',
							styleValue: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
						},
					},
				},
			};
		}

		return { id: deviceId, schema: { type: 'panel', items: {} } };
	}

	/* ── Instance info: compact cards + dashboard link ── */
	getInstanceInfo() {
		const config  = this.adapter.config;
		const actions = [];

		const iframeUrl = (config.iframeUrl || '').trim();
		if (/^https?:\/\//i.test(iframeUrl)) {
			actions.push({
				id:    'open-dashboard',
				icon:  'web',
				title: { en: 'Open SOLECTRUS Dashboard', de: 'SOLECTRUS-Dashboard öffnen' },
				url:   iframeUrl,
			});
		}

		return {
			apiVersion:           'v3',
			communicationStateId: 'info.deviceManager',
			smallCards:           true,
			actions,
		};
	}
}

module.exports = { SolectrusDeviceManagement };
