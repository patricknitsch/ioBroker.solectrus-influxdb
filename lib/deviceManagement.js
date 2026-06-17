'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');

/* ── Helpers (identisch zu tab.html) ── */
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
			const stateId   = sensorStateId(this.adapter, sensor);
			const isInternal = !!sensor.internal;
			const isNumeric  = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
			const unit       = sensor.unit || (isNumeric ? 'W' : '');

			const controls = [
				{
					id:      'value',
					type:    'info',
					stateId,
					label:   { en: 'Value', de: 'Wert' },
					unit,
					color:   isInternal ? '#fdd835' : 'primary',
				},
			];

			/* Alive-Timeout: zweite Info-Zeile */
			if (sensor.aliveTimeoutMinutes > 0) {
				controls.push({
					id:    'alive',
					type:  'info',
					label: { en: `Alive Timeout: ${sensor.aliveTimeoutMinutes} min`, de: `Alive-Timeout: ${sensor.aliveTimeoutMinutes} min` },
				});
			}

			/* MaxValue-Monitoring: dritte Info-Zeile */
			if (sensor.maxValue > 0) {
				controls.push({
					id:    'maxval',
					type:  'info',
					label: { en: `Max: ${sensor.maxValue}${unit ? ' ' + unit : ''}`, de: `Max: ${sensor.maxValue}${unit ? ' ' + unit : ''}` },
				});
			}

			const device = {
				id:         { sensor: sensor.SensorName },
				name:       sensor.SensorName,
				hasDetails: true,
				controls,
				color:      isInternal ? '#fdd835' : undefined,
				group:      {
					key:  sensor.group || 'default-solectrus',
					name: sensor.group || { en: 'Default SOLECTRUS Sensors', de: 'Standard SOLECTRUS-Sensoren' },
				},
			};

			/* Verbindungsstatus wenn Alive-Monitoring aktiv */
			if (sensor.aliveTimeoutMinutes > 0) {
				device.status = { connection: { stateId } };
			}

			context.addDevice(device);
		}

		/* ── Data-SOLECTRUS-Elemente (Formel-Engine) ── */
		for (const item of dsItems) {
			const stateId = dsItemStateId(this.adapter, item);
			if (!stateId) continue;

			context.addDevice({
				id:         { ds: item.targetId, group: item.group || '' },
				name:       item.name || item.targetId,
				hasDetails: true,
				controls:   [
					{
						id:      'value',
						type:    'info',
						stateId,
						label:   { en: 'Value', de: 'Wert' },
						unit:    item.unit || '',
						color:   'primary',
					},
				],
				group:      {
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
			if (!sensor) return { id: deviceId, schema: {} };

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
					type: 'object',
					properties: {
						type:        { type: 'string', label: { en: 'Type', de: 'Typ' },                     disabled: true },
						measurement: { type: 'string', label: 'Measurement',                                 disabled: true },
						field:       { type: 'string', label: 'Field',                                       disabled: true },
						sourceState: { type: 'string', label: { en: 'Source State', de: 'Quell-State' },     disabled: true },
						timestamp:   { type: 'string', label: { en: 'Last Update', de: 'Letzter Update' },   disabled: true },
					},
				},
			};
		}

		/* DS-Element-Details */
		if (deviceId.ds) {
			const item = (config.dsItems || []).find(
				it => it.targetId === deviceId.ds && (it.group || '') === (deviceId.group || ''),
			);
			if (!item) return { id: deviceId, schema: {} };

			const stateId = dsItemStateId(this.adapter, item);
			const state   = stateId ? await this.adapter.getForeignStateAsync(stateId).catch(() => null) : null;
			const mode    = item.mode || 'formula';
			let   expr    = '';
			if (mode === 'formula')                            expr = item.formula || '';
			else if (mode === 'source' || mode === 'sourceState') expr = item.sourceState || '';
			else if (mode === 'jsonPath')                      expr = (item.sourceState || '') + (item.jsonPath ? ' → ' + item.jsonPath : '');
			else if (mode === 'state-machine')                 expr = '[state-machine]';

			return {
				id:   deviceId,
				data: {
					mode:      mode,
					formula:   expr,
					stateId:   stateId || '',
					timestamp: state && state.ts ? new Date(state.ts).toLocaleString() : '',
				},
				schema: {
					type: 'object',
					properties: {
						mode:      { type: 'string', label: { en: 'Mode', de: 'Modus' },                  disabled: true },
						formula:   { type: 'string', label: { en: 'Formula / Expression', de: 'Formel / Ausdruck' }, disabled: true },
						stateId:   { type: 'string', label: 'State ID',                                    disabled: true },
						timestamp: { type: 'string', label: { en: 'Last Update', de: 'Letzter Update' },   disabled: true },
					},
				},
			};
		}

		return { id: deviceId, schema: {} };
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
