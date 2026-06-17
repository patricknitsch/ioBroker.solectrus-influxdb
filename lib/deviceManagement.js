'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');

/* ── Helpers ── */
function sensorStateId(adapter, sensor) {
	const name = (sensor.SensorName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
	return `${adapter.namespace}.sensors.${name}`;
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

	/* ── Geräteliste laden ── */
	async loadDevices(context) {
		const config = this.adapter.config;

		const sensors = (config.sensors || []).filter(s => s && s.enabled && s.SensorName);
		const dsItems = config.enableDataSolectrus
			? (config.dsItems || []).filter(it => it && it.enabled && it.targetId)
			: [];

		context.setTotalDevices(sensors.length + dsItems.length);

		/* ── InfluxDB-Sensoren ── */
		for (const sensor of sensors) {
			const stateId    = sensorStateId(this.adapter, sensor);
			const isInternal = !!sensor.internal;
			const isNumeric  = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
			const unit       = sensor.unit || (isNumeric ? 'W' : '');
			const maxVal     = sensor.maxValue > 0 ? sensor.maxValue : null;
			const aliveMs    = sensor.aliveTimeoutMinutes > 0 ? sensor.aliveTimeoutMinutes * 60000 : null;

			const state       = await this.adapter.getForeignStateAsync(stateId).catch(() => null);
			const numVal      = state && typeof state.val === 'number' ? state.val : null;
			const isMaxExc    = maxVal !== null && numVal !== null && numVal > maxVal;
			const isAliveStale = aliveMs && state && state.ts ? (Date.now() - state.ts) > aliveMs : false;

			/* Value color: red > yellow(internal) > green */
			const valueColor = isMaxExc ? '#e53935' : isInternal ? '#fdd835' : '#388e3c';
			const valStr     = fmtVal(state ? state.val : null);
			const valDisplay = unit ? `${valStr} ${unit}` : valStr;

			/* Items shown directly on the main card via customInfo */
			const customItems = {
				value: {
					type:       'staticInfo',
					label:      { en: 'Value', de: 'Wert' },
					data:       valDisplay,
					styleValue: { color: valueColor, fontWeight: 'bold', fontSize: '1.1em' },
				},
			};

			if (aliveMs) {
				const tsDisplay  = state && state.ts ? new Date(state.ts).toLocaleTimeString() : '–';
				const aliveColor = isAliveStale ? '#e67e22' : '#388e3c';
				customItems.lastUpdate = {
					type:       'staticInfo',
					label:      { en: 'Last Update', de: 'Letzter Update' },
					data:       tsDisplay,
					styleValue: { color: aliveColor },
				};
			}

			if (maxVal !== null) {
				customItems.maxval = {
					type:       'staticInfo',
					label:      { en: 'Max Value', de: 'Max-Wert' },
					data:       `${maxVal}${unit ? ' ' + unit : ''}`,
					styleValue: isMaxExc ? { color: '#e53935' } : {},
				};
			}

			const device = {
				id:         { sensor: sensor.SensorName },
				name:       sensor.SensorName,
				hasDetails: true,
				/* No color → card header/name stays at default (white) */
				customInfo: {
					id:     { sensor: sensor.SensorName },
					schema: { type: 'panel', items: customItems },
				},
				group: {
					key:  sensor.group || 'default-solectrus',
					name: sensor.group || { en: 'Default SOLECTRUS Sensors', de: 'Standard SOLECTRUS-Sensoren' },
				},
			};

			/* Alive-monitoring: show connected/disconnected indicator */
			if (aliveMs) {
				device.status = { connection: isAliveStale ? 'disconnected' : 'connected' };
			}

			context.addDevice(device);
		}

		/* ── Data-SOLECTRUS-Elemente (Formel-Engine) ── */
		for (const item of dsItems) {
			const stateId = dsItemStateId(this.adapter, item);
			if (!stateId) continue;

			const state      = await this.adapter.getForeignStateAsync(stateId).catch(() => null);
			const unit       = item.unit || '';
			const valStr     = fmtVal(state ? state.val : null);
			const valDisplay = unit ? `${valStr} ${unit}` : valStr;

			context.addDevice({
				id:         { ds: item.targetId, group: item.group || '' },
				name:       item.name || item.targetId,
				hasDetails: true,
				customInfo: {
					id:     { ds: item.targetId, group: item.group || '' },
					schema: {
						type:  'panel',
						items: {
							value: {
								type:       'staticInfo',
								label:      { en: 'Value', de: 'Wert' },
								data:       valDisplay,
								styleValue: { color: '#388e3c', fontWeight: 'bold', fontSize: '1.1em' },
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
			});
		}
	}

	/* ── Gerätedetails (Tab "Details" im DM) ── */
	async getDeviceDetails(deviceId) {
		const config = this.adapter.config;

		/* Sensor-Details */
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
					timestamp:   state && state.ts ? new Date(state.ts).toLocaleString() : '',
				},
				schema: {
					type: 'panel',
					items: {
						type:        { type: 'text', label: { en: 'Type', de: 'Typ' },                    disabled: true },
						measurement: { type: 'text', label: 'Measurement',                                disabled: true },
						field:       { type: 'text', label: 'Field',                                      disabled: true },
						sourceState: { type: 'text', label: { en: 'Source State', de: 'Quell-State' },    disabled: true },
						timestamp:   { type: 'text', label: { en: 'Last Update', de: 'Letzter Update' },  disabled: true },
					},
				},
			};
		}

		/* DS-Element-Details */
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
					mode:      mode,
					formula:   expr,
					stateId:   stateId || '',
					timestamp: state && state.ts ? new Date(state.ts).toLocaleString() : '',
				},
				schema: {
					type: 'panel',
					items: {
						mode:      { type: 'text', label: { en: 'Mode', de: 'Modus' },                          disabled: true },
						formula:   { type: 'text', label: { en: 'Formula / Expression', de: 'Formel / Ausdruck' }, disabled: true },
						stateId:   { type: 'text', label: 'State ID',                                            disabled: true },
						timestamp: { type: 'text', label: { en: 'Last Update', de: 'Letzter Update' },           disabled: true },
					},
				},
			};
		}

		return { id: deviceId, schema: { type: 'panel', items: {} } };
	}

	/* ── Instanzinfo & Aktionen ── */
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
			apiVersion: 'v3',
			actions,
		};
	}
}

module.exports = { SolectrusDeviceManagement };
