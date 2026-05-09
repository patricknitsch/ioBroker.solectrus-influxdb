'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');
const { getSensorStateId } = require('./helpers');

/**
 * Device Management integration for ioBroker Device Manager.
 *
 * Exposes each enabled InfluxDB sensor and Data-SOLECTRUS item as a device
 * tile. The tile shows the live value (via stateId subscription), measurement /
 * field / type metadata and the source state directly – no additional detail
 * tabs needed.
 */
class SolectrusDeviceManagement extends DeviceManagement {
	/**
	 * @param {import('@iobroker/adapter-core').AdapterInstance} adapter - The ioBroker adapter instance.
	 */
	constructor(adapter) {
		super(adapter);
	}

	/**
	 * @returns {import('@iobroker/dm-utils').InstanceDetails} Instance info with API version.
	 */
	getInstanceInfo() {
		return { apiVersion: 'v3' };
	}

	/**
	 * Build device tiles for every enabled sensor and DS item.
	 * Called by the Device Manager when the user opens the adapter in Admin.
	 *
	 * @param {import('@iobroker/dm-utils').DeviceLoadContext} context - Device load context provided by dm-utils.
	 */
	async loadDevices(context) {
		const ns = this.adapter.namespace;
		const config = this.adapter.config;
		const now = Date.now();

		const sensors = (config.sensors || []).filter(s => s && s.enabled && s.SensorName);
		const dsItems = config.enableDataSolectrus
			? (config.dsItems || []).filter(it => it && it.enabled && it.targetId)
			: [];

		context.setTotalDevices(sensors.length + dsItems.length);

		/* ── InfluxDB Sensors ─────────────────────────────────────────── */
		for (const sensor of sensors) {
			const relId = getSensorStateId(sensor);
			const fullId = `${ns}.${relId}`;

			let state = null;
			try {
				state = await this.adapter.getStateAsync(relId);
			} catch {
				/* ignore – state may not exist yet */
			}

			const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;
			const isNumeric = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';

			/* Connection / warning status */
			let connection = hasVal ? 'connected' : 'disconnected';
			let warning = false;

			if (hasVal && sensor.aliveTimeoutMinutes > 0 && state.ts) {
				const isZeroVal = state.val === 0 || state.val === '0';
				const timeoutMinutes = isZeroVal ? 60 : sensor.aliveTimeoutMinutes;
				if (now - state.ts > timeoutMinutes * 60_000) {
					connection = 'disconnected';
					warning = true;
				}
			}
			if (!warning && hasVal && isNumeric && sensor.maxValue > 0) {
				const numVal = parseFloat(state.val);
				if (!isNaN(numVal) && numVal > sensor.maxValue) {
					warning = {
						en: `Value ${numVal} exceeds max ${sensor.maxValue}${sensor.unit ? ` ${sensor.unit}` : ''}`,
						de: `Wert ${numVal} überschreitet Max ${sensor.maxValue}${sensor.unit ? ` ${sensor.unit}` : ''}`,
					};
				}
			}

			/* Manufacturer / model line shown on the tile */
			const manufacturer = sensor.measurement || undefined;
			const modelParts = [sensor.field, sensor.type ? `[${sensor.type}]` : ''].filter(Boolean);
			const model = modelParts.length ? modelParts.join(' ') : undefined;

			/* Live value control (subscribes via stateId – auto-refreshes) */
			const valueControl = {
				id: 'value',
				type: 'info',
				stateId: fullId,
				label: { en: 'Value', de: 'Wert' },
				showSemicolon: true,
				noTranslation: true,
			};
			if (hasVal) {
				valueControl.state = state;
			}
			if (isNumeric) {
				valueControl.unit = sensor.unit || 'W';
			} else if (sensor.type === 'bool') {
				valueControl.textFalse = 'false';
				valueControl.textTrue = 'true';
			}

			context.addDevice({
				id: relId,
				name: sensor.SensorName,
				identifier: sensor.sourceState || undefined,
				manufacturer,
				model,
				status: {
					connection,
					...(warning !== false && { warning }),
				},
				controls: [valueControl],
				hasDetails: false,
				group: {
					key: 'sensors',
					name: { en: 'InfluxDB Sensors', de: 'InfluxDB-Sensoren' },
				},
			});
		}

		/* ── Data-SOLECTRUS (Formula Engine) items ────────────────────── */
		for (const item of dsItems) {
			const groupPrefix = (item.group || '').trim();
			const tid = (item.targetId || '').trim();
			if (!tid) {
				continue;
			}

			const relId = `ds.${groupPrefix ? `${groupPrefix}.${tid}` : tid}`;
			const fullId = `${ns}.${relId}`;

			let state = null;
			try {
				state = await this.adapter.getStateAsync(relId);
			} catch {
				/* ignore */
			}

			const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;

			const valueControl = {
				id: 'value',
				type: 'info',
				stateId: fullId,
				label: { en: 'Value', de: 'Wert' },
				showSemicolon: true,
				noTranslation: true,
			};
			if (hasVal) {
				valueControl.state = state;
			}

			context.addDevice({
				id: relId,
				name: item.name || item.targetId,
				identifier: fullId,
				status: { connection: hasVal ? 'connected' : 'disconnected' },
				controls: [valueControl],
				hasDetails: false,
				group: {
					key: 'ds',
					name: { en: 'Formula Engine', de: 'Formel-Engine' },
				},
			});
		}
	}
}

module.exports = { SolectrusDeviceManagement };
