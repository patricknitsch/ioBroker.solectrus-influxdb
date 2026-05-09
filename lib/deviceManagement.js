'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');
const { getSensorStateId } = require('./helpers');

/* ── Colour constants (match SOLECTRUS / ioBroker theme) ── */
const COLOR_OK = '#388e3c'; // always-green base colour for sensor tiles
const COLOR_ERROR = '#e53935'; // red when max-value is exceeded

/**
 * Returns a human-readable formatted value string.
 *
 * @param {*} val - Raw state value.
 * @param {object} sensor - Sensor configuration object.
 * @returns {string} Formatted value string with optional unit.
 */
function formatSensorValue(val, sensor) {
	if (val === null || val === undefined) {
		return 'n/a';
	}
	const isNumeric = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
	if (isNumeric) {
		const unit = sensor.unit || '';
		const num = parseFloat(val);
		const formatted = isNaN(num) ? String(val) : num.toLocaleString('de-DE');
		return unit ? `${formatted} ${unit}` : formatted;
	}
	if (sensor.type === 'bool') {
		return val ? 'true' : 'false';
	}
	return String(val);
}

/**
 * Builds a staticText schema item for one key-value info row.
 *
 * @param {string} label - Row label.
 * @param {string} value - Row value.
 * @returns {object} JSON config staticText item.
 */
function infoRow(label, value) {
	return { type: 'staticText', text: `${label}: ${value}`, sm: 12, newLine: true };
}

/**
 * Device Management integration for ioBroker Device Manager.
 *
 * Exposes each enabled InfluxDB sensor and Data-SOLECTRUS item as a device
 * tile. Tile shows manufacturer = measurement, model = field [type] and the
 * current sensor value via customInfo. A warning icon is shown when maxValue
 * is exceeded or the alive-timeout interval is exceeded. The tile is green by
 * default and turns red when maxValue is exceeded. The details panel (info
 * button) shows all sensor information: ID, value, limits, last update, etc.
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

			let state = null;
			try {
				state = await this.adapter.getStateAsync(relId);
			} catch {
				/* ignore – state may not exist yet */
			}

			const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;
			const isNumeric = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';

			/* ── Stale / timeout check ── */
			const isZeroVal = hasVal && (state.val === 0 || state.val === '0');
			const timeoutMinutes = isZeroVal ? 60 : sensor.aliveTimeoutMinutes;
			const isStale =
				hasVal && sensor.aliveTimeoutMinutes > 0 && !!state.ts && now - state.ts > timeoutMinutes * 60_000;

			/* ── Max-value check ── */
			const numVal = hasVal && isNumeric ? parseFloat(state.val) : NaN;
			const isOverMax = !isNaN(numVal) && sensor.maxValue > 0 && numVal > sensor.maxValue;

			/* ── Status: always connected (green) when we have a value;
			       warning icon for stale OR maxValue exceeded;
			       tile colour turns red only when maxValue exceeded ── */
			const connection = hasVal ? 'connected' : 'disconnected';
			const warning = isStale || isOverMax;
			const color = isOverMax ? COLOR_ERROR : COLOR_OK;

			/* ── Tile metadata ── */
			const manufacturer = sensor.measurement || undefined;
			const modelParts = [sensor.field, sensor.type ? `[${sensor.type}]` : ''].filter(Boolean);
			const model = modelParts.length ? modelParts.join(' ') : undefined;

			/* ── customInfo: current value displayed on the tile ── */
			const valueText = hasVal ? formatSensorValue(state.val, sensor) : 'n/a';
			const customInfo = {
				id: relId,
				schema: {
					type: 'panel',
					items: {
						_v: { type: 'staticText', text: valueText, sm: 12 },
					},
				},
			};

			context.addDevice({
				id: relId,
				name: sensor.SensorName,
				/* identifier intentionally omitted – source state shown only in details */
				manufacturer,
				model,
				color,
				status: {
					connection,
					...(warning && { warning: true }),
				},
				customInfo,
				hasDetails: true,
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

			let state = null;
			try {
				state = await this.adapter.getStateAsync(relId);
			} catch {
				/* ignore */
			}

			const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;

			const valueText = hasVal ? String(state.val) : 'n/a';
			const customInfo = {
				id: relId,
				schema: {
					type: 'panel',
					items: {
						_v: { type: 'staticText', text: valueText, sm: 12 },
					},
				},
			};

			context.addDevice({
				id: relId,
				name: item.name || item.targetId,
				/* identifier intentionally omitted */
				color: COLOR_OK,
				status: { connection: hasVal ? 'connected' : 'disconnected' },
				customInfo,
				hasDetails: true,
				group: {
					key: 'ds',
					name: { en: 'Formula Engine', de: 'Formel-Engine' },
				},
			});
		}
	}

	/**
	 * Returns the detail schema shown when the user clicks the info button on a tile.
	 * Shows all sensor/DS item information: ID, value, limits, last update, etc.
	 *
	 * @param {string} id - Device relId (e.g. "sensors.house_power" or "ds.group.item").
	 * @returns {Promise<object>} DeviceDetails object with JSON config schema.
	 */
	async getDeviceDetails(id) {
		if (typeof id === 'string' && id.startsWith('ds.')) {
			return this._getDsItemDetails(id);
		}
		return this._getSensorDetails(id);
	}

	/**
	 * Builds the details panel for an InfluxDB sensor.
	 *
	 * @param {string} relId - Relative state ID (e.g. "sensors.house_power").
	 * @returns {Promise<object>} DeviceDetails schema.
	 */
	async _getSensorDetails(relId) {
		const ns = this.adapter.namespace;
		const fullId = `${ns}.${relId}`;
		const config = this.adapter.config;
		const now = Date.now();

		const sensor = (config.sensors || []).find(s => getSensorStateId(s) === relId);
		if (!sensor) {
			return {
				id: relId,
				schema: {
					type: 'panel',
					items: { _err: { type: 'staticText', text: `Sensor not found: ${relId}`, sm: 12 } },
				},
			};
		}

		let state = null;
		try {
			state = await this.adapter.getStateAsync(relId);
		} catch {
			/* ignore */
		}

		const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;
		const isNumeric = sensor.type !== 'bool' && sensor.type !== 'string' && sensor.type !== 'json';
		const numVal = hasVal && isNumeric ? parseFloat(state.val) : NaN;
		const isOverMax = !isNaN(numVal) && sensor.maxValue > 0 && numVal > sensor.maxValue;

		/* Staleness */
		const isZeroVal = hasVal && (state.val === 0 || state.val === '0');
		const timeoutMinutes = isZeroVal ? 60 : sensor.aliveTimeoutMinutes;
		const isStale =
			hasVal && sensor.aliveTimeoutMinutes > 0 && !!state.ts && now - state.ts > timeoutMinutes * 60_000;

		/* Timestamps */
		const tsStr = state?.ts ? new Date(state.ts).toLocaleString('de-DE') : 'n/a';
		const nextExpectedStr =
			state?.ts && sensor.aliveTimeoutMinutes > 0
				? new Date(state.ts + timeoutMinutes * 60_000).toLocaleString('de-DE')
				: null;

		const items = {};

		/* ── State ID ── */
		items._h_id = { type: 'header', text: { en: 'State ID', de: 'State-ID' }, sm: 12 };
		items._id = { type: 'staticText', text: fullId, sm: 12, newLine: true };

		/* ── Current Value ── */
		items._h_val = {
			type: 'header',
			text: { en: 'Current Value', de: 'Aktueller Wert' },
			sm: 12,
			newLine: true,
		};
		let valLine = hasVal ? formatSensorValue(state.val, sensor) : 'n/a';
		if (isOverMax) {
			const unit = sensor.unit || '';
			valLine += ` ⚠ Max: ${sensor.maxValue}${unit ? ` ${unit}` : ''}`;
		}
		if (isStale) {
			valLine += ' ⚠ veraltet / stale';
		}
		items._val = { type: 'staticText', text: valLine, sm: 12, newLine: true };

		/* ── Source state ── */
		if (sensor.sourceState) {
			items._h_src = {
				type: 'header',
				text: { en: 'Source State', de: 'Quell-Datenpunkt' },
				sm: 12,
				newLine: true,
			};
			items._src = { type: 'staticText', text: sensor.sourceState, sm: 12, newLine: true };
		}

		/* ── InfluxDB config ── */
		items._h_influx = {
			type: 'header',
			text: { en: 'InfluxDB Configuration', de: 'InfluxDB-Konfiguration' },
			sm: 12,
			newLine: true,
		};
		items._meas = infoRow('Measurement', sensor.measurement || 'n/a');
		items._field = infoRow('Field', sensor.field || 'n/a');
		items._dtype = infoRow('Type', sensor.type || 'n/a');
		if (isNumeric && sensor.unit) {
			items._unit = infoRow('Unit', sensor.unit);
		}
		if (sensor.maxValue > 0) {
			const unit = sensor.unit || '';
			items._max = infoRow('Max Value', `${sensor.maxValue}${unit ? ` ${unit}` : ''}`);
		}

		/* ── Timing ── */
		items._h_timing = {
			type: 'header',
			text: { en: 'Timing', de: 'Zeitstempel' },
			sm: 12,
			newLine: true,
		};
		items._ts = infoRow('Last Update', isStale ? `${tsStr} ⚠ stale` : tsStr);
		if (sensor.aliveTimeoutMinutes > 0) {
			items._timeout = infoRow(
				'Alive Timeout',
				`${sensor.aliveTimeoutMinutes} min${isZeroVal ? ' (60 min for zero value)' : ''}`,
			);
			if (nextExpectedStr) {
				items._next = infoRow('Next Expected', nextExpectedStr);
			}
		}

		return {
			id: relId,
			schema: { type: 'panel', items },
		};
	}

	/**
	 * Builds the details panel for a Data-SOLECTRUS item.
	 *
	 * @param {string} relId - Relative state ID (e.g. "ds.group.targetId").
	 * @returns {Promise<object>} DeviceDetails schema.
	 */
	async _getDsItemDetails(relId) {
		const ns = this.adapter.namespace;
		const fullId = `${ns}.${relId}`;
		const config = this.adapter.config;

		/* Reconstruct group/targetId from relId ("ds.<group?>.<targetId>") */
		const parts = relId.slice(3).split('.'); // strip "ds." prefix
		const dsItem = (config.dsItems || []).find(it => {
			const groupPrefix = (it.group || '').trim();
			const tid = (it.targetId || '').trim();
			const expected = groupPrefix ? `${groupPrefix}.${tid}` : tid;
			return parts.join('.') === expected;
		});

		let state = null;
		try {
			state = await this.adapter.getStateAsync(relId);
		} catch {
			/* ignore */
		}

		const hasVal = state !== null && state !== undefined && state.val !== null && state.val !== undefined;
		const tsStr = state?.ts ? new Date(state.ts).toLocaleString('de-DE') : 'n/a';

		const items = {};

		/* ── State ID ── */
		items._h_id = { type: 'header', text: { en: 'State ID', de: 'State-ID' }, sm: 12 };
		items._id = { type: 'staticText', text: fullId, sm: 12, newLine: true };

		/* ── Current Value ── */
		items._h_val = {
			type: 'header',
			text: { en: 'Current Value', de: 'Aktueller Wert' },
			sm: 12,
			newLine: true,
		};
		items._val = {
			type: 'staticText',
			text: hasVal ? String(state.val) : 'n/a',
			sm: 12,
			newLine: true,
		};

		/* ── DS item config ── */
		if (dsItem) {
			items._h_cfg = {
				type: 'header',
				text: { en: 'Formula Engine Configuration', de: 'Formel-Engine-Konfiguration' },
				sm: 12,
				newLine: true,
			};
			if (dsItem.name) {
				items._name = infoRow('Name', dsItem.name);
			}
			items._tid = infoRow('Target ID', dsItem.targetId || 'n/a');
			if (dsItem.group) {
				items._grp = infoRow('Group', dsItem.group);
			}
			if (dsItem.mode) {
				items._mode = infoRow('Mode', dsItem.mode);
			}
			if (dsItem.formula) {
				items._formula = infoRow('Formula', dsItem.formula);
			}
			if (dsItem.sourceState) {
				items._src = infoRow('Source State', dsItem.sourceState);
			}
		}

		/* ── Timing ── */
		items._h_timing = {
			type: 'header',
			text: { en: 'Timing', de: 'Zeitstempel' },
			sm: 12,
			newLine: true,
		};
		items._ts = infoRow('Last Update', tsStr);

		return {
			id: relId,
			schema: { type: 'panel', items },
		};
	}
}

module.exports = { SolectrusDeviceManagement };
