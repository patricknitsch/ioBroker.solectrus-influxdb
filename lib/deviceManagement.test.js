'use strict';

/* global describe, it */

const { expect } = require('chai');

const { buildDevices, buildSensorDevice, buildItemDevice } = require('./deviceManagement');

const NS = 'solectrus-influxdb.0';

/**
 * Evaluates a text pattern the way the JSON config of ioBroker.admin does.
 *
 * @param {object} item - The JSON config item.
 * @param {object} states - The values of `_states`.
 * @param {string} [lang] - The language.
 * @returns {string} The text.
 */
function text(item, states, lang = 'en') {
	const pattern = item.text.func[lang].replace(/`/g, '\\`');
	return new Function('_states', `return \`${pattern}\``)(states);
}

/**
 * Evaluates the `hidden` condition the way the JSON config of ioBroker.admin does.
 *
 * @param {object} item - The JSON config item.
 * @param {object} states - The values of `_states`.
 * @returns {boolean} True when the item is hidden.
 */
function hidden(item, states) {
	return item.hidden ? !!new Function('_states', item.hidden)(states) : false;
}

/**
 * Returns the keys of the visible items of the "Value" tab.
 *
 * @param {object} device - The device info.
 * @param {object} states - The values of `_states`.
 * @returns {string[]} The keys.
 */
function visible(device, states) {
	const items = device.customInfo.schema.items.dmValue.items;
	return Object.keys(items).filter(key => !hidden(items[key], states));
}

describe('device manager cards', () => {
	const sensor = {
		enabled: true,
		SensorName: 'Cooking',
		type: 'float',
		measurement: 'cooking',
		field: 'power',
		sourceState: 'alias.0.kitchen.POWER',
		maxValue: 10000,
		aliveTimeoutMinutes: 10,
	};

	it('groups the cards like the overview tab', () => {
		const devices = buildDevices(NS, {
			enableDataSolectrus: true,
			sensors: [
				{ ...sensor, SensorName: 'Internal', internal: true },
				sensor,
				{ ...sensor, SensorName: 'Disabled', enabled: false },
				// same state id as "Cooking": the device manager needs unique ids
				{ ...sensor, SensorName: 'cooking' },
			],
			dsItems: [
				{ enabled: true, group: 'CustomPower', targetId: 'heaters', name: 'Heaters', formula: 'a + b' },
				{ enabled: false, targetId: 'off' },
			],
		});

		expect(devices.map(d => [d.name, d.group.key, d.backgroundColor])).to.deep.equal([
			['Cooking', 'influx', '#388e3c'],
			['Internal', 'internal', '#fdd835'],
			['Heaters', 'formula', '#fdd835'],
		]);
		expect(devices[0].id).to.equal('sensors.cooking');
		expect(devices[2].id).to.equal('ds.CustomPower.heaters');
	});

	it('does not show formula engine items when the formula engine is off', () => {
		const devices = buildDevices(NS, { sensors: [sensor], dsItems: [{ enabled: true, targetId: 'x' }] });

		expect(devices).to.have.length(1);
	});

	it('shows the value of a sensor in its color, with limit, timestamp and details', () => {
		const device = buildSensorDevice(NS, sensor);
		const items = device.customInfo.schema.items.dmValue.items;
		const ts = Date.UTC(2026, 10, 15, 12, 0, 0);
		const states = { v: { val: 2.5, ts }, staleSensors: { val: '[]' } };

		expect(items.value.dependsOnStates.v).to.equal(`${NS}.sensors.cooking`);
		expect(visible(device, states)).to.deep.equal(['value', 'max', 'ts', 'expected']);
		expect(items.value.style.color).to.equal('#388e3c');
		expect(text(items.value, states)).to.equal('2.5 W');
		expect(text(items.value, { v: null })).to.equal('n/a');
		expect(text(items.value, { v: null }, 'de')).to.equal('k.A.');
		expect(items.max.text).to.equal('10000 W');
		expect(text(items.ts, states)).to.equal(`Timestamp: ${new Date(ts).toLocaleString()}`);
		expect(text(items.expected, states)).to.equal(new Date(ts + 10 * 60_000).toLocaleTimeString());
		// a sensor with the value 0 is checked every 60 minutes only
		expect(text(items.expected, { v: { val: 0, ts } })).to.equal(new Date(ts + 60 * 60_000).toLocaleTimeString());

		const details = device.customInfo.schema.items.dmDetails.items;
		expect(Object.keys(details).map(key => details[key].data)).to.deep.equal([
			'cooking',
			'power',
			'float',
			'alias.0.kitchen.POWER',
			`${NS}.sensors.cooking`,
		]);
	});

	it('shows an exceeded value and its limit in red', () => {
		const device = buildSensorDevice(NS, sensor);
		const items = device.customInfo.schema.items.dmValue.items;
		// exceeded takes precedence over timed out
		const states = { v: { val: 12000, ts: 1 }, staleSensors: { val: '["Cooking"]' } };

		expect(visible(device, states)).to.deep.equal(['valueMax', 'maxMax', 'tsTimeout', 'expectedTimeout']);
		expect(items.valueMax.style.color).to.equal('#e53935');
		expect(items.maxMax.style.color).to.equal('#e53935');
	});

	it('shows a timed out value with timestamp and stale inputs in orange', () => {
		const device = buildSensorDevice(NS, sensor);
		const items = device.customInfo.schema.items.dmValue.items;
		const stale = { val: JSON.stringify({ Cooking: [{ id: 'alias.0.a', ts: 5 }, { id: 'alias.0.b' }] }) };
		const states = { v: { val: 2.5, ts: 1 }, staleSensors: { val: '["Cooking"]' }, stale };

		expect(visible(device, states)).to.deep.equal([
			'valueTimeout',
			'max',
			'tsTimeout',
			'expectedTimeout',
			'staleInputs',
		]);
		for (const key of ['valueTimeout', 'tsTimeout', 'expectedTimeout', 'staleInputs']) {
			expect(items[key].style.color).to.equal('#e67e22');
		}
		expect(items.staleInputs.dependsOnStates.stale).to.equal(`${NS}.info.staleInputs`);
		expect(text(items.staleInputs, states, 'de')).to.equal(
			`Eingang ohne Aktualisierung: alias.0.a (${new Date(5).toLocaleString()})\n` +
				'Eingang ohne Aktualisierung: alias.0.b',
		);
	});

	it('shows sensors without limit and timeout, internal and JSON sensors', () => {
		const plain = buildSensorDevice(NS, { enabled: true, SensorName: 'A `$` "B"', type: 'string', internal: true });
		const plainItems = plain.customInfo.schema.items.dmValue.items;
		expect(Object.keys(plainItems)).to.deep.equal(['value', 'ts']);
		expect(plainItems.value.style.color).to.equal('#fdd835');
		expect(text(plainItems.value, { v: { val: 'standby' } })).to.equal('standby');

		// a name with special characters does not break the code of the conditions
		const special = buildSensorDevice(NS, { enabled: true, SensorName: 'A `$` "B"', aliveTimeoutMinutes: 5 });
		expect(visible(special, { v: { val: 1 }, staleSensors: { val: JSON.stringify(['A `$` "B"']) } })).to.include(
			'valueTimeout',
		);

		const json = buildSensorDevice(NS, { enabled: true, SensorName: 'Forecast', type: 'json' });
		const jsonItems = json.customInfo.schema.items.dmValue.items;
		const val = JSON.stringify([{ t: 1, y: 2 }, { t: 2 }, { t: 3 }]);
		expect(text(jsonItems.value, { v: { val } })).to.equal('{"t":1,"y":2} (+2 more entries)');
		expect(text(jsonItems.value, { v: { val: '[]' } })).to.equal('[]');
	});

	it('shows a formula engine item with the timeout of the sensor using it', () => {
		const item = {
			enabled: true,
			group: 'CustomPower',
			targetId: 'multimedia',
			name: 'Multimedia',
			formula: 'a + b',
		};
		const sensors = [
			{
				enabled: true,
				SensorName: 'Multimedia',
				sourceState: `${NS}.ds.CustomPower.multimedia`,
				aliveTimeoutMinutes: 10,
			},
		];
		const device = buildItemDevice(NS, { ...item, aliveTimeoutMinutes: 99 }, sensors);
		const items = device.customInfo.schema.items.dmValue.items;
		const stale = { val: JSON.stringify({ 'CustomPower.multimedia': [{ id: 'alias.0.a' }] }) };

		expect(items.value.dependsOnStates).to.deep.equal({
			v: `${NS}.ds.CustomPower.multimedia`,
			stale: `${NS}.info.staleFormulaInputs`,
		});
		expect(visible(device, { v: { val: 59.9, ts: 1 }, stale: { val: '{}' } })).to.deep.equal([
			'value',
			'ts',
			'inputTimeout',
		]);
		expect(visible(device, { v: { val: 59.9, ts: 1 }, stale })).to.deep.equal([
			'valueTimeout',
			'tsTimeout',
			'inputTimeoutTimeout',
			'staleInputs',
		]);
		expect(items.value.style.color).to.equal('#fdd835');
		expect(items.valueTimeout.style.color).to.equal('#e67e22');
		expect(text(items.value, { v: { val: 59.9 } })).to.equal('59.9 W');
		expect(text(items.inputTimeout, {}, 'de')).to.equal('Eingänge: 10 min (Multimedia)');

		const details = device.customInfo.schema.items.dmDetails.items;
		expect(Object.keys(details).map(key => details[key].data)).to.deep.equal([
			`${NS}.ds.CustomPower.multimedia`,
			'Formula',
			'a + b',
		]);

		// without a sensor the own timeout of the item applies; without timeout nothing is monitored
		const own = buildItemDevice(NS, { ...item, aliveTimeoutMinutes: 15 }, []);
		expect(text(own.customInfo.schema.items.dmValue.items.inputTimeout, {})).to.equal('Inputs: 15 min');
		const none = buildItemDevice(NS, item, []);
		expect(Object.keys(none.customInfo.schema.items.dmValue.items)).to.deep.equal(['value', 'ts']);
		expect(buildItemDevice(NS, { enabled: true, targetId: 'not valid' }, [])).to.equal(null);
	});
});
