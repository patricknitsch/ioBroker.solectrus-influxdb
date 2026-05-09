'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');
const { getSensorStateId } = require('./helpers');

/* ── Value/text styling constants ── */
const VALUE_COLOR_NORMAL = '#388e3c'; // green
const VALUE_COLOR_ALERT = '#e53935'; // red on max exceeded
const INFO_FONT_SIZE = 'normal';

/**
 * For json-type values: parses the JSON and returns only the first element
 * or first property value as a string. Falls back to the raw string.
 *
 * @param {*} val - Raw state value (string or object).
 * @returns {string} First value extracted from the JSON.
 */
function extractFirstJsonValue(val) {
	if (val === null || val === undefined) {
		return 'n/a';
	}
	let parsed;
	try {
		parsed = typeof val === 'string' ? JSON.parse(val) : val;
	} catch {
		return String(val);
	}
	if (Array.isArray(parsed)) {
		return parsed.length > 0 ? String(parsed[0]) : '[]';
	}
	if (typeof parsed === 'object' && parsed !== null) {
		const keys = Object.keys(parsed);
		return keys.length > 0 ? String(parsed[keys[0]]) : '{}';
	}
	return String(parsed);
}

/**
 * Returns a human-readable formatted value string with unit embedded.
 * Numeric values are localized; unit (if any) is appended with a space.
 * JSON values show only the first element/property. Bool shows true/false.
 *
 * @param {*} val - Raw state value.
 * @param {object} sensor - Sensor configuration object.
 * @returns {string} Formatted value string (unit included for numeric types).
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
	if (sensor.type === 'json') {
		return extractFirstJsonValue(val);
	}
	return String(val);
}

/**
 * Builds a staticInfo schema item for one key-value info row.
 *
 * @param {ioBroker.StringOrTranslated} label - Row label.
 * @param {string|number|boolean} value - Row value.
 * @param {object} [options] - Optional style settings.
 * @param {string} [options.valueColor] - Optional value color.
 * @param {number|string} [options.size] - Optional font size.
 * @param {boolean} [options.bold] - If true, renders value in bold.
 * @returns {object} JSON config staticInfo item.
 */
function infoRow(label, value, options = {}) {
	const { valueColor, size = INFO_FONT_SIZE, bold } = options;
	return {
		type: 'staticInfo',
		label,
		data: value,
		addColon: true,
		size,
		sm: 12,
		newLine: true,
		styleLabel: { textAlign: 'left' },
		styleValue: {
			textAlign: 'right',
			...(valueColor ? { color: valueColor } : {}),
			...(bold ? { fontWeight: 'bold' } : {}),
		},
	};
}

/**
 * Device Management integration for ioBroker Device Manager.
 *
 * Exposes each enabled InfluxDB sensor and Data-SOLECTRUS item as a device
 * tile. Sensor tile rows show Measurement, Field, Datentyp and Aktueller Wert.
 * The current value text is green by default and red when maxValue is exceeded.
 * Warning icon is shown when maxValue or alive-timeout is exceeded. The details
 * panel (info button) shows all sensor information.
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

			/* ── Warning icon for stale OR maxValue exceeded ── */
			const warning = isStale || isOverMax;
			const valueColor = isOverMax ? VALUE_COLOR_ALERT : VALUE_COLOR_NORMAL;

			/* ── customInfo rows on tile ── */
			const valueStr = hasVal ? formatSensorValue(state.val, sensor) : 'n/a';
			const customInfo = {
				id: relId,
				schema: {
					type: 'panel',
					items: {
						_meas: infoRow('Measurement', sensor.measurement || 'n/a'),
						_field: infoRow('Field', sensor.field || 'n/a'),
						_type: infoRow({ en: 'Data Type', de: 'Datentyp' }, sensor.type || 'n/a'),
						_val: infoRow({ en: 'Current Value', de: 'Aktueller Wert' }, valueStr, {
							valueColor,
							bold: true,
						}),
					},
				},
			};

			context.addDevice({
				id: relId,
				name: sensor.SensorName,
				/* identifier intentionally omitted – source state shown only in details */
				customInfo,
				...(warning && { status: { warning: true } }),
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

			/* Safely convert any value type (including objects) to a display string */
			const dsValueText = hasVal ? extractFirstJsonValue(state.val) : 'n/a';
			const customInfo = {
				id: relId,
				schema: {
					type: 'panel',
					items: {
						_val: infoRow({ en: 'Current Value', de: 'Aktueller Wert' }, dsValueText, { bold: true }),
					},
				},
			};

			context.addDevice({
				id: relId,
				name: item.name || item.targetId,
				/* identifier intentionally omitted */
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
		items._h_info = { type: 'header', text: { en: 'Info', de: 'Info' }, size: 2, sm: 12 };

		/* ── State ID ── */
		items._id = infoRow({ en: 'State ID', de: 'State-ID' }, fullId);

		/* ── Current Value (bold, unit embedded in string) ── */
		const valStr = hasVal ? formatSensorValue(state.val, sensor) : 'n/a';
		let valLine = valStr;
		if (isOverMax) {
			const u = sensor.unit || '';
			valLine += ` ⚠ Max: ${sensor.maxValue}${u ? ` ${u}` : ''}`;
		}
		if (isStale) {
			valLine += ' ⚠ veraltet / stale';
		}
		items._val = infoRow({ en: 'Current Value', de: 'Aktueller Wert' }, valLine, {
			valueColor: isOverMax ? VALUE_COLOR_ALERT : VALUE_COLOR_NORMAL,
			bold: true,
		});

		/* ── Source state ── */
		if (sensor.sourceState) {
			items._src = infoRow({ en: 'Source State', de: 'Quell-Datenpunkt' }, sensor.sourceState);
		}

		/* ── InfluxDB config ── */
		items._h_influx = {
			type: 'header',
			text: { en: 'InfluxDB Configuration', de: 'InfluxDB-Konfiguration' },
			size: 4,
			sm: 12,
			newLine: true,
		};
		items._meas = infoRow('Measurement', sensor.measurement || 'n/a');
		items._field = infoRow('Field', sensor.field || 'n/a');
		items._dtype = infoRow({ en: 'Data Type', de: 'Datentyp' }, sensor.type || 'n/a');
		if (isNumeric && sensor.unit) {
			items._unit = infoRow({ en: 'Unit', de: 'Einheit' }, sensor.unit);
		}

		/* ── Monitoring / Überwachungen ── */
		items._h_timing = {
			type: 'header',
			text: { en: 'Monitoring', de: 'Überwachungen' },
			size: 4,
			sm: 12,
			newLine: true,
		};
		items._ts = infoRow({ en: 'Last Update', de: 'Letztes Update' }, isStale ? `${tsStr} ⚠ stale` : tsStr);
		if (sensor.aliveTimeoutMinutes > 0) {
			items._timeout = infoRow(
				{ en: 'Alive Timeout', de: 'Timeout' },
				`${sensor.aliveTimeoutMinutes} min${isZeroVal ? ' (60 min for zero value)' : ''}`,
			);
			if (nextExpectedStr) {
				items._next = infoRow({ en: 'Next Expected', de: 'Nächste Aktualisierung' }, nextExpectedStr);
			}
		}
		if (sensor.maxValue > 0) {
			const u = sensor.unit || '';
			items._max = infoRow({ en: 'Max Value', de: 'Maximalwert' }, `${sensor.maxValue}${u ? ` ${u}` : ''}`);
		}

		return {
			id: relId,
			schema: { type: 'panel', items, innerStyle: { maxWidth: '480px' } },
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
		items._h_info = { type: 'header', text: { en: 'Info', de: 'Info' }, size: 2, sm: 12 };

		/* ── State ID ── */
		items._id = infoRow({ en: 'State ID', de: 'State-ID' }, fullId);

		/* ── Current Value (bold; object-safe via extractFirstJsonValue) ── */
		items._val = infoRow(
			{ en: 'Current Value', de: 'Aktueller Wert' },
			hasVal ? extractFirstJsonValue(state.val) : 'n/a',
			{ bold: true },
		);

		/* ── DS item config ── */
		if (dsItem) {
			items._h_cfg = {
				type: 'header',
				text: { en: 'Formula Engine Configuration', de: 'Formel-Engine-Konfiguration' },
				size: 4,
				sm: 12,
				newLine: true,
			};
			if (dsItem.name) {
				items._name = infoRow('Name', dsItem.name);
			}
			items._tid = infoRow({ en: 'Target ID', de: 'Ziel-ID' }, dsItem.targetId || 'n/a');
			if (dsItem.group) {
				items._grp = infoRow({ en: 'Group', de: 'Gruppe' }, dsItem.group);
			}
			if (dsItem.mode) {
				items._mode = infoRow({ en: 'Mode', de: 'Modus' }, dsItem.mode);
			}
			if (dsItem.formula) {
				items._formula = infoRow({ en: 'Formula', de: 'Formel' }, dsItem.formula);
			}
			if (dsItem.sourceState) {
				items._src = infoRow({ en: 'Source State', de: 'Quell-Datenpunkt' }, dsItem.sourceState);
			}
		}

		/* ── Monitoring / Überwachungen ── */
		items._h_timing = {
			type: 'header',
			text: { en: 'Monitoring', de: 'Überwachungen' },
			size: 4,
			sm: 12,
			newLine: true,
		};
		items._ts = infoRow({ en: 'Last Update', de: 'Letztes Update' }, tsStr);

		return {
			id: relId,
			schema: { type: 'panel', items, innerStyle: { maxWidth: '480px' } },
		};
	}
}

module.exports = { SolectrusDeviceManagement };
