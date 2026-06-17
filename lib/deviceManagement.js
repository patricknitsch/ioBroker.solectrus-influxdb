'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');

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

/* ── Device Manager ── */
class SolectrusDeviceManagement extends DeviceManagement {

	constructor(adapter) {
		super(adapter); // communicationState is created lazily in loadDevices (DB must be connected)
		this._sensorByStateId = new Map(); // fullStateId → sensor config
		this._dsItemByStateId = new Map(); // fullStateId → ds item config
	}

	/* ── Build DeviceInfo for a sensor ── */
	async _buildSensorDevice(sensor, state) {
		const stateId    = sensorStateId(this.adapter, sensor);
		const isInternal = !!sensor.internal;
		const isNumeric  = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
		const unit       = sensor.unit || (isNumeric ? 'W' : '');
		const maxVal     = sensor.maxValue > 0 ? sensor.maxValue : null;
		const aliveMs    = sensor.aliveTimeoutMinutes > 0 ? sensor.aliveTimeoutMinutes * 60000 : null;

		if (!state) {
			state = await this.adapter.getForeignStateAsync(stateId).catch(() => null);
		}

		const numVal = state && typeof state.val === 'number' ? state.val : null;
		const isMaxExc = maxVal !== null && numVal !== null && numVal > maxVal;

		/* Value color: red if max exceeded, yellow if internal, else green */
		const valueColor = isMaxExc ? '#e53935' : isInternal ? '#fdd835' : '#388e3c';
		const valStr     = fmtVal(state ? state.val : null);
		const valDisplay = unit ? `${valStr} ${unit}` : valStr;

		/* Use lastUpdateTs for accurate source timestamp (set from original foreign state.ts) */
		const relId  = sensorRelId(sensor);
		const lastTs = (this.adapter.lastUpdateTs instanceof Map && this.adapter.lastUpdateTs.get(relId))
			|| (state && state.ts)
			|| 0;
		const isAliveStale = aliveMs ? (Date.now() - lastTs) > aliveMs && lastTs > 0 : false;

		/* Last valid value (substitute used when maxValue is exceeded) */
		const lastValid = this.adapter.lastValidValue instanceof Map
			? this.adapter.lastValidValue.get(relId)
			: undefined;
		const lastValStr     = fmtVal(lastValid !== undefined ? lastValid : null);
		const lastValDisplay = unit ? `${lastValStr} ${unit}` : lastValStr;

		/* Timestamp */
		const tsDisplay  = lastTs ? new Date(lastTs).toLocaleTimeString() : '–';
		const aliveColor = isAliveStale ? '#e67e22' : '#388e3c';

		/* Last-seen timestamp (replaces "last valid value in Watts") */
		const lastSeenDisplay = lastTs ? new Date(lastTs).toLocaleString() : '–';
		const staleColor      = '#e67e22';

		const customItems = {
			value: {
				type:       'staticInfo',
				label:      { en: 'Value:', de: 'Wert:' },
				data:       valDisplay,
				styleLabel: { fontWeight: 'bold' },
				styleValue: { color: valueColor, fontWeight: 'bold', fontSize: '1.1em' },
			},
		};

		if (maxVal !== null) {
			customItems.maxval = {
				type:       'staticInfo',
				label:      { en: 'Max Value:', de: 'Max-Wert:' },
				data:       `${maxVal}${unit ? ' ' + unit : ''}`,
				styleLabel: { fontWeight: 'bold' },
				styleValue: isMaxExc ? { color: '#e53935' } : {},
			};
		}

		customItems.timestamp = {
			type:       'staticInfo',
			label:      { en: 'Timestamp:', de: 'Zeitstempel:' },
			data:       tsDisplay,
			styleLabel: { fontWeight: 'bold' },
			styleValue: (aliveMs && isAliveStale) ? { color: staleColor } : {},
		};

		customItems.lastValue = {
			type:       'staticInfo',
			label:      { en: 'Last Seen:', de: 'Letzter Wert:' },
			data:       lastSeenDisplay,
			styleLabel: { fontWeight: 'bold' },
			styleValue: (aliveMs && isAliveStale) ? { color: staleColor } : {},
		};

		return {
			id:         { sensor: sensor.SensorName },
			name:       sensor.SensorName.toUpperCase(),
			hasDetails: true,
			color:      isInternal ? '#fdd835' : '#388e3c',
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

		/* Unit: prefer config, fall back to state object's common.unit */
		let unit = (item.unit || '').trim();
		if (!unit && stateId) {
			const obj = await this.adapter.getForeignObjectAsync(stateId).catch(() => null);
			unit = (obj && obj.common && obj.common.unit) || '';
		}

		const valStr     = fmtVal(state ? state.val : null);
		const valDisplay = unit ? `${valStr} ${unit}` : valStr;
		const tsDisplay  = state && state.ts ? new Date(state.ts).toLocaleTimeString() : '–';

		return {
			id:         { ds: item.targetId, group: item.group || '' },
			name:       (item.name || item.targetId).toUpperCase(),
			hasDetails: true,
			color:      '#388e3c',
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
							styleValue: { color: '#388e3c', fontWeight: 'bold', fontSize: '1.1em' },
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

	/* ── Lazy communication state setup (DB must be connected) ── */
	async _initCommState() {
		if (this.communicationStateId) return;
		this.communicationStateId = 'info.deviceManager';
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

	/* ── Load all devices ── */
	async loadDevices(context) {
		await this._initCommState();

		const config = this.adapter.config;

		const sensors = (config.sensors || []).filter(s => s && s.enabled && s.SensorName);
		const dsItems = config.enableDataSolectrus
			? (config.dsItems || []).filter(it => it && it.enabled && it.targetId)
			: [];

		context.setTotalDevices(sensors.length + dsItems.length);

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

	/* ── Push real-time update to GUI when a state changes ──
	 * Called from adapter.onStateChange() with the full state ID.
	 * Looks up which device (sensor or DS item) owns this state and pushes
	 * an infoUpdate command through the communicationState channel. */
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

			const stateId = sensorStateId(this.adapter, sensor);
			const state   = await this.adapter.getForeignStateAsync(stateId).catch(() => null);

			return {
				id:   deviceId,
				data: {
					type:        sensor.type || '',
					measurement: sensor.measurement || '',
					field:       sensor.field || '',
					sourceState: sensor.sourceState || '',
				},
				schema: {
					type:  'panel',
					items: {
						type:        { type: 'text', label: { en: 'Type', de: 'Typ' },                 readOnly: true },
						measurement: { type: 'text', label: 'Measurement',                             readOnly: true },
						field:       { type: 'text', label: 'Field',                                   readOnly: true },
						sourceState: { type: 'text', label: { en: 'Source State', de: 'Quell-State' }, readOnly: true, minRows: 3, maxRows: 6, style: { fontSize: '1rem' } },
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
			const state   = stateId ? await this.adapter.getForeignStateAsync(stateId).catch(() => null) : null;
			const mode    = item.mode || 'formula';
			let   expr    = '';
			if (mode === 'formula')                               expr = item.formula || '';
			else if (mode === 'source' || mode === 'sourceState') expr = item.sourceState || '';
			else if (mode === 'jsonPath')                         expr = (item.sourceState || '') + (item.jsonPath ? ' → ' + item.jsonPath : '');
			else if (mode === 'state-machine')                    expr = '[state-machine]';

			return {
				id:   deviceId,
				data: {
					mode:    mode,
					formula: expr,
					stateId: stateId || '',
				},
				schema: {
					type:  'panel',
					items: {
						mode:    { type: 'text', label: { en: 'Mode', de: 'Modus' },                             readOnly: true },
						formula: { type: 'text', label: { en: 'Formula / Expression', de: 'Formel / Ausdruck' }, readOnly: true, minRows: 2, maxRows: 6, style: { fontSize: '1rem' } },
						stateId: { type: 'text', label: 'State ID',                                              readOnly: true, minRows: 2, maxRows: 3, style: { fontSize: '1rem' } },
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
