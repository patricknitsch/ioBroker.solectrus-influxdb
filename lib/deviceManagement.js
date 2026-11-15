'use strict';

const { DeviceManagement } = require('@iobroker/dm-utils');
const { DEFAULT_MAX_VALUE } = require('./constants');
const { getSensorStateId } = require('./helpers');
const { getItemOutputId } = require('./data-solectrus/services/itemIds');

/** Colors of the overview tab (admin/tab.html) */
const COLOR_INFLUX = '#388e3c';
const COLOR_INTERNAL = '#fdd835';
const COLOR_TIMEOUT = '#e67e22';
const COLOR_MAX = '#e53935';

/** Max. characters of a JSON value preview (as in the overview tab) */
const TRUNCATE_VAL_LEN = 60;

const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** Texts of the cards; languages without an entry fall back to English. */
const TEXTS = {
	groupInflux: {
		en: 'InfluxDB Sensors',
		de: 'InfluxDB-Sensoren',
		ru: 'Датчики InfluxDB',
		pt: 'Sensores InfluxDB',
		nl: 'InfluxDB-sensoren',
		fr: 'Capteurs InfluxDB',
		it: 'Sensori InfluxDB',
		es: 'Sensores InfluxDB',
		pl: 'Czujniki InfluxDB',
		uk: 'Датчики InfluxDB',
		'zh-cn': 'InfluxDB 传感器',
	},
	groupInternal: {
		en: 'Internal Sensors',
		de: 'Interne Sensoren',
		ru: 'Внутренние датчики',
		pt: 'Sensores internos',
		nl: 'Interne sensoren',
		fr: 'Capteurs internes',
		it: 'Sensori interni',
		es: 'Sensores internos',
		pl: 'Czujniki wewnętrzne',
		uk: 'Внутрішні датчики',
		'zh-cn': '内部传感器',
	},
	groupFormula: {
		en: 'Formula Engine',
		de: 'Formel-Engine',
		ru: 'Движок формул',
		pt: 'Motor de fórmulas',
		nl: 'Formule-engine',
		fr: 'Moteur de formules',
		it: 'Motore di formule',
		es: 'Motor de fórmulas',
		pl: 'Silnik formuł',
		uk: 'Рушій формул',
		'zh-cn': '公式引擎',
	},
	tabValue: {
		en: 'Value',
		de: 'Wert',
		ru: 'Значение',
		pt: 'Valor',
		nl: 'Waarde',
		fr: 'Valeur',
		it: 'Valore',
		es: 'Valor',
		pl: 'Wartość',
		uk: 'Значення',
		'zh-cn': '值',
	},
	tabDetails: {
		en: 'Details',
		de: 'Details',
		ru: 'Детали',
		pt: 'Detalhes',
		nl: 'Details',
		fr: 'Détails',
		it: 'Dettagli',
		es: 'Detalles',
		pl: 'Szczegóły',
		uk: 'Деталі',
		'zh-cn': '详情',
	},
	na: { en: 'n/a', de: 'k.A.' },
	moreEntries: { en: 'more entries', de: 'weitere Einträge' },
	lastUpdate: { en: 'Timestamp:', de: 'Zeitstempel:' },
	staleInput: { en: 'Input without update:', de: 'Eingang ohne Aktualisierung:' },
	inputTimeout: { en: 'Inputs:', de: 'Eingänge:' },
	measurement: { en: 'Measurement', de: 'Measurement' },
	field: { en: 'Field', de: 'Field' },
	type: { en: 'Type', de: 'Typ' },
	sourceState: { en: 'Source State', de: 'Quell-State' },
	state: { en: 'State', de: 'State' },
	mode: { en: 'Mode', de: 'Modus' },
	formula: { en: 'Formula', de: 'Formel' },
};

const TEXT_LANGUAGES = ['en', 'de'];

/**
 * Returns the text as a JavaScript string literal that can be used inside the code of a
 * JSON config pattern. Backticks and `$` are escaped: the pattern is evaluated as a template literal.
 *
 * @param {unknown} text - The text.
 * @returns {string} The string literal (with double quotes).
 */
function jsString(text) {
	return JSON.stringify(String(text)).replace(/`/g, '\\u0060').replace(/\$/g, '\\u0024');
}

/**
 * Builds a text that is calculated in the browser from the states of `dependsOnStates`.
 *
 * @param {(t: (key: string) => string) => string} build - Returns the JavaScript expression of the
 *   text; `t(key)` gives the string literal of the text in the language of the expression.
 * @returns {object} The text for a JSON config item: one pattern per language.
 */
function liveText(build) {
	const func = {};
	for (const lang of TEXT_LANGUAGES) {
		func[lang] = `\${${build(key => jsString(TEXTS[key][lang] || TEXTS[key].en))}}`;
	}
	return { func };
}

/**
 * Returns the item once per variant. Exactly one variant is visible at a time, so the color
 * of a text can follow the states.
 *
 * @param {string} key - The key of the item in the panel.
 * @param {object} item - The JSON config item.
 * @param {{ suffix: string, color: string, hidden: string }[]} variants - The variants; `hidden` is
 *   the JavaScript condition that hides the variant, '' for "always visible".
 * @returns {object} The items by key.
 */
function colorVariants(key, item, variants) {
	const result = {};
	for (const variant of variants) {
		const copy = { ...item };
		if (variant.color) {
			copy.style = { ...item.style, color: variant.color };
		}
		if (variant.hidden) {
			copy.hidden = `return (${variant.hidden});`;
		}
		result[key + variant.suffix] = copy;
	}
	return result;
}

const STYLE_VALUE = {
	fontSize: 18,
	fontWeight: 700,
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
};
const STYLE_VALUE_JSON = { fontSize: 11, fontFamily: MONO, wordBreak: 'break-all' };
const STYLE_BADGE = { fontSize: 10, fontFamily: MONO, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' };
const STYLE_LINE = { fontSize: 11, overflowWrap: 'anywhere' };
const STYLE_STALE_INPUTS = { fontSize: 10, fontFamily: MONO, overflowWrap: 'anywhere', whiteSpace: 'pre-line' };

/**
 * A static line of the "Details" tab: label on the left, value on the right.
 *
 * @param {string} labelKey - The key of the label in TEXTS.
 * @param {unknown} value - The value.
 * @returns {object} The JSON config item.
 */
function detailLine(labelKey, value) {
	return {
		type: 'staticInfo',
		label: TEXTS[labelKey],
		data: String(value),
		addColon: true,
		size: 11,
		styleLabel: { marginRight: 8, fontWeight: 'normal', opacity: 0.7 },
		styleValue: { fontFamily: MONO, textAlign: 'right', overflowWrap: 'anywhere' },
	};
}

/**
 * The lines "Input without update: <id> (<time>)" of a card.
 *
 * @param {string} stateId - The id of the state with the stale inputs (JSON object).
 * @param {string} key - The key of the card in that object.
 * @returns {{ item: object, hasStale: string }} The JSON config item and the JavaScript condition
 *   that is true while the card has stale inputs.
 */
function staleInputLines(stateId, key) {
	const list = `(JSON.parse(_states.stale?.val || '{}')[${jsString(key)}] || [])`;
	return {
		hasStale: `${list}.length > 0`,
		item: {
			type: 'staticText',
			dependsOnStates: { stale: stateId },
			text: liveText(
				t =>
					`${list}.map(i => ${t('staleInput')} + ' ' + i.id + ` +
					`(i.ts ? ' (' + new Date(i.ts).toLocaleString() + ')' : '')).join('\\n')`,
			),
			hidden: `return !(${list}.length > 0);`,
			style: { ...STYLE_STALE_INPUTS, color: COLOR_TIMEOUT },
		},
	};
}

/**
 * Builds the card with the two tabs "Value" and "Details".
 *
 * @param {string} id - The id of the device.
 * @param {object} valueItems - The items of the "Value" tab.
 * @param {object} detailItems - The items of the "Details" tab.
 * @returns {object} The custom info of the device.
 */
function buildCustomInfo(id, valueItems, detailItems) {
	return {
		id,
		schema: {
			type: 'tabs',
			items: {
				dmValue: { type: 'panel', label: TEXTS.tabValue, items: valueItems },
				dmDetails: { type: 'panel', label: TEXTS.tabDetails, items: detailItems },
			},
		},
	};
}

/**
 * Builds the device manager card of a sensor. It shows what the card of the overview tab shows:
 * value (red with the limit when the maximum is exceeded, orange when timed out), measurement,
 * field, type, source state, timestamp and the stale inputs of the item feeding the sensor.
 *
 * @param {string} namespace - The namespace of the adapter instance.
 * @param {object} sensor - The sensor configuration.
 * @returns {object} The device info.
 */
function buildSensorDevice(namespace, sensor) {
	const stateId = `${namespace}.${getSensorStateId(sensor)}`;
	const isInternal = !!sensor.internal;
	const isJson = sensor.type === 'json';
	const isNumeric = sensor.type !== 'bool' && sensor.type !== 'string' && !isJson;
	const unit = sensor.unit || 'W';
	const maxValue = isNumeric && sensor.maxValue != null ? Number(sensor.maxValue) : DEFAULT_MAX_VALUE;
	const hasMax = maxValue > DEFAULT_MAX_VALUE;
	const timeoutMin = Number(sensor.aliveTimeoutMinutes) > 0 ? Number(sensor.aliveTimeoutMinutes) : 0;
	const color = isInternal ? COLOR_INTERNAL : COLOR_INFLUX;
	const name = jsString(sensor.SensorName);

	// Conditions, evaluated in the browser
	const isStale = `JSON.parse(_states.staleSensors?.val || '[]').includes(${name})`;
	const isExceeded = `parseFloat(_states.v?.val) > ${maxValue}`;
	const states = { v: stateId, staleSensors: `${namespace}.info.staleSensors` };

	let valueText;
	if (isJson) {
		// JSON arrays show the first entry and the number of further entries
		valueText = liveText(
			t =>
				`(v => { if (v === null || v === undefined) return ${t('na')}; let p = v; ` +
				`if (typeof v === 'string') { try { p = JSON.parse(v); } catch (e) { p = v; } } ` +
				`if (Array.isArray(p)) { if (!p.length) return '[]'; let f = JSON.stringify(p[0]); ` +
				`if (f.length > ${TRUNCATE_VAL_LEN}) f = f.slice(0, ${TRUNCATE_VAL_LEN}) + '…'; ` +
				`return p.length === 1 ? f : f + ' (+' + (p.length - 1) + ' ' + ${t('moreEntries')} + ')'; } ` +
				`return typeof v === 'object' ? JSON.stringify(v).slice(0, ${TRUNCATE_VAL_LEN}) : String(v); })(_states.v?.val)`,
		);
	} else {
		valueText = liveText(
			t =>
				`(v => v === null || v === undefined ? ${t('na')} : (typeof v === 'object' ? ` +
				`JSON.stringify(v).slice(0, ${TRUNCATE_VAL_LEN}) : String(v))${isNumeric ? ` + ${jsString(` ${unit}`)}` : ''})(_states.v?.val)`,
		);
	}

	const valueItem = {
		type: 'staticText',
		dependsOnStates: states,
		text: valueText,
		xs: hasMax ? 8 : 12,
		style: isJson ? STYLE_VALUE_JSON : STYLE_VALUE,
	};
	const valueItems = hasMax
		? {
				...colorVariants('value', valueItem, [
					{ suffix: '', color, hidden: `${isStale} || ${isExceeded}` },
					{ suffix: 'Timeout', color: COLOR_TIMEOUT, hidden: `!(${isStale}) || ${isExceeded}` },
					{ suffix: 'Max', color: COLOR_MAX, hidden: `!(${isExceeded})` },
				]),
				...colorVariants(
					'max',
					{
						type: 'staticText',
						dependsOnStates: states,
						text: `${maxValue} ${unit}`,
						noTranslation: true,
						xs: 4,
						style: STYLE_BADGE,
					},
					[
						{ suffix: '', color: '', hidden: isExceeded },
						{ suffix: 'Max', color: COLOR_MAX, hidden: `!(${isExceeded})` },
					],
				),
			}
		: timeoutMin
			? colorVariants('value', valueItem, [
					{ suffix: '', color, hidden: isStale },
					{ suffix: 'Timeout', color: COLOR_TIMEOUT, hidden: `!(${isStale})` },
				])
			: colorVariants('value', valueItem, [{ suffix: '', color, hidden: '' }]);

	// Timestamp; with an alive timeout also the time the next update is expected by
	const tsItem = {
		type: 'staticText',
		dependsOnStates: states,
		text: liveText(
			t => `(s => s && s.ts ? ${t('lastUpdate')} + ' ' + new Date(s.ts).toLocaleString() : '')(_states.v)`,
		),
		style: STYLE_LINE,
	};
	if (timeoutMin) {
		Object.assign(
			valueItems,
			colorVariants('ts', tsItem, [
				{ suffix: '', color: '', hidden: isStale },
				{ suffix: 'Timeout', color: COLOR_TIMEOUT, hidden: `!(${isStale})` },
			]),
			colorVariants(
				'expected',
				{
					type: 'staticText',
					dependsOnStates: states,
					// A sensor with the value 0 is checked every 60 minutes only
					text: liveText(
						() =>
							`(s => s && s.ts ? new Date(s.ts + ((s.val === 0 || s.val === '0') ? 60 : ${timeoutMin}) * 60000)` +
							`.toLocaleTimeString() : '')(_states.v)`,
					),
					style: STYLE_BADGE,
				},
				[
					{ suffix: '', color: '', hidden: isStale },
					{ suffix: 'Timeout', color: COLOR_TIMEOUT, hidden: `!(${isStale})` },
				],
			),
		);
		valueItems.staleInputs = staleInputLines(`${namespace}.info.staleInputs`, sensor.SensorName).item;
	} else {
		valueItems.ts = tsItem;
	}

	const detailItems = {};
	if (sensor.measurement) {
		detailItems.measurement = detailLine('measurement', sensor.measurement);
	}
	if (sensor.field) {
		detailItems.field = detailLine('field', sensor.field);
	}
	if (sensor.type) {
		detailItems.type = detailLine('type', sensor.type);
	}
	if (sensor.sourceState) {
		detailItems.sourceState = detailLine('sourceState', sensor.sourceState);
	}
	detailItems.state = detailLine('state', stateId);

	const id = getSensorStateId(sensor);
	return {
		id,
		name: String(sensor.SensorName),
		backgroundColor: color,
		group: isInternal ? { key: 'internal', name: TEXTS.groupInternal } : { key: 'influx', name: TEXTS.groupInflux },
		customInfo: buildCustomInfo(id, valueItems, detailItems),
	};
}

/**
 * Returns the expression of a formula engine item as shown in the overview tab.
 *
 * @param {object} item - The item configuration.
 * @returns {string} The expression.
 */
function getItemExpression(item) {
	const mode = item.mode || 'formula';
	if (mode === 'formula') {
		return item.formula || '';
	}
	if (mode === 'source' || mode === 'sourceState') {
		return item.sourceState || '';
	}
	if (mode === 'jsonPath') {
		return (item.sourceState || '') + (item.jsonPath ? ` → ${item.jsonPath}` : '');
	}
	if (mode === 'state-machine') {
		return '[state-machine]';
	}
	return '';
}

const ITEM_MODE_LABELS = {
	formula: 'Formula',
	source: 'Source',
	sourceState: 'Source',
	jsonPath: 'JSONPath',
	'state-machine': 'State Machine',
};

/**
 * Builds the device manager card of a formula engine item: value (orange while an input timed
 * out), state id, mode, expression, timestamp, the alive timeout of the inputs and the stale inputs.
 *
 * @param {string} namespace - The namespace of the adapter instance.
 * @param {object} item - The item configuration.
 * @param {object[]} sensors - The configured sensors.
 * @returns {object|null} The device info, or null when the item has no valid output id.
 */
function buildItemDevice(namespace, item, sensors) {
	const outputId = getItemOutputId(item);
	if (!outputId) {
		return null;
	}
	const stateId = `${namespace}.ds.${outputId}`;
	const isNumeric = item.type !== 'boolean' && item.type !== 'string';
	const mode = item.mode || 'formula';

	// A sensor takes precedence: an item used by an enabled sensor is monitored with the
	// timeout of that sensor.
	const usingSensors = (sensors || []).filter(sn => sn && sn.enabled && sn.sourceState === stateId);
	const monitoringSensor = usingSensors.find(sn => Number(sn.aliveTimeoutMinutes) > 0);
	const timeoutMin = usingSensors.length
		? monitoringSensor
			? Number(monitoringSensor.aliveTimeoutMinutes)
			: 0
		: Number(item.aliveTimeoutMinutes) > 0
			? Number(item.aliveTimeoutMinutes)
			: 0;

	const states = { v: stateId, stale: `${namespace}.info.staleFormulaInputs` };
	const stale = staleInputLines(states.stale, outputId);
	const variants = timeoutMin
		? [
				{ suffix: '', color: COLOR_INTERNAL, hidden: stale.hasStale },
				{ suffix: 'Timeout', color: COLOR_TIMEOUT, hidden: `!(${stale.hasStale})` },
			]
		: [{ suffix: '', color: COLOR_INTERNAL, hidden: '' }];

	const valueItems = colorVariants(
		'value',
		{
			type: 'staticText',
			dependsOnStates: states,
			text: liveText(
				t =>
					`(v => v === null || v === undefined ? ${t('na')} : (typeof v === 'object' ? ` +
					`JSON.stringify(v).slice(0, ${TRUNCATE_VAL_LEN}) : String(v))` +
					`${isNumeric ? ` + ${jsString(` ${item.unit || 'W'}`)}` : ''})(_states.v?.val)`,
			),
			style: STYLE_VALUE,
		},
		variants,
	);

	const tsItem = {
		type: 'staticText',
		dependsOnStates: states,
		text: liveText(
			t => `(s => s && s.ts ? ${t('lastUpdate')} + ' ' + new Date(s.ts).toLocaleString() : '')(_states.v)`,
		),
		style: STYLE_LINE,
	};
	if (timeoutMin) {
		// The item is recalculated on every tick; the timeout applies to its inputs
		const noColor = variants.map(variant => ({ ...variant, color: variant.suffix ? variant.color : '' }));
		Object.assign(
			valueItems,
			colorVariants('ts', tsItem, noColor),
			colorVariants(
				'inputTimeout',
				{
					type: 'staticText',
					dependsOnStates: states,
					text: liveText(
						t =>
							`${t('inputTimeout')} + ${jsString(
								` ${timeoutMin} min${monitoringSensor ? ` (${monitoringSensor.SensorName})` : ''}`,
							)}`,
					),
					style: { ...STYLE_BADGE, whiteSpace: 'normal' },
				},
				noColor,
			),
		);
		valueItems.staleInputs = stale.item;
	} else {
		valueItems.ts = tsItem;
	}

	const detailItems = {
		state: detailLine('state', stateId),
		mode: detailLine('mode', ITEM_MODE_LABELS[mode] || mode),
	};
	const expression = getItemExpression(item);
	if (expression) {
		detailItems.formula = detailLine('formula', expression);
	}

	const id = `ds.${outputId}`;
	return {
		id,
		name: String(item.name || item.targetId),
		// Formula engine items are never written to InfluxDB: styled like internal sensors
		backgroundColor: COLOR_INTERNAL,
		group: { key: 'formula', name: TEXTS.groupFormula },
		customInfo: buildCustomInfo(id, valueItems, detailItems),
	};
}

/**
 * Builds the device manager cards of all enabled sensors and formula engine items,
 * in the order of the overview tab: InfluxDB sensors, internal sensors, formula engine.
 *
 * @param {string} namespace - The namespace of the adapter instance.
 * @param {object} config - The adapter configuration.
 * @returns {object[]} The device infos.
 */
function buildDevices(namespace, config) {
	const sensors = Array.isArray(config.sensors) ? config.sensors : [];
	const active = sensors.filter(s => s && s.enabled && s.SensorName);
	const devices = [
		...active.filter(s => !s.internal).map(s => buildSensorDevice(namespace, s)),
		...active.filter(s => !!s.internal).map(s => buildSensorDevice(namespace, s)),
	];
	if (config.enableDataSolectrus) {
		const items = Array.isArray(config.dsItems) ? config.dsItems : [];
		for (const item of items) {
			if (item && item.enabled && item.targetId) {
				devices.push(buildItemDevice(namespace, item, sensors));
			}
		}
	}
	// The device manager needs unique ids
	const seen = new Set();
	return devices.filter(device => {
		const key = device && device.id;
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/**
 * Shows the sensors and formula engine items in the device manager of ioBroker.admin.
 */
class SolectrusDeviceManagement extends DeviceManagement {
	/**
	 * @param {import('@iobroker/dm-utils').DeviceLoadContext<string>} context - The load context of the device manager.
	 */
	loadDevices(context) {
		const devices = buildDevices(this.adapter.namespace, this.adapter.config);
		context.setTotalDevices(devices.length);
		for (const device of devices) {
			context.addDevice(device);
		}
	}
}

module.exports = { SolectrusDeviceManagement, buildDevices, buildSensorDevice, buildItemDevice };
