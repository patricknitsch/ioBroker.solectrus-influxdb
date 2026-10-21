'use strict';

/* global describe, it */

const { expect } = require('chai');
const { checkAdminVersionCompatibility, buildInfluxUrl, getInfluxConfig } = require('./helpers');

function makeAdapter(adminObjects) {
	const states = {};
	const errors = [];
	return {
		log: { error: msg => errors.push(msg), debug: () => {} },
		getForeignObjectsAsync: async () => adminObjects,
		setState: (id, val) => {
			states[id] = val;
		},
		_states: states,
		_errors: errors,
	};
}

describe('checkAdminVersionCompatibility', () => {
	it('logs an error and sets info.lastError when the installed admin is below 8.0.0', async () => {
		const adapter = makeAdapter({
			'system.adapter.admin.0': { common: { version: '7.9.13' } },
		});

		await checkAdminVersionCompatibility(adapter);

		expect(adapter._errors).to.have.lengthOf(1);
		expect(adapter._errors[0]).to.include('ioBroker.admin');
		expect(adapter._errors[0]).to.include('7.9.13');
		expect(adapter._states['info.lastError']).to.include('ioBroker.admin');
	});

	it('does nothing when the installed admin is 8.0.0 or newer (including alpha pre-releases)', async () => {
		const adapter = makeAdapter({
			'system.adapter.admin.0': { common: { version: '8.0.1-alpha.2' } },
		});

		await checkAdminVersionCompatibility(adapter);

		expect(adapter._errors).to.have.lengthOf(0);
		expect(adapter._states['info.lastError']).to.be.undefined;
	});

	it('does nothing when no admin instance object can be found', async () => {
		const adapter = makeAdapter({});

		await checkAdminVersionCompatibility(adapter);

		expect(adapter._errors).to.have.lengthOf(0);
	});

	it('does not throw when getForeignObjectsAsync rejects', async () => {
		const adapter = makeAdapter({});
		adapter.getForeignObjectsAsync = async () => {
			throw new Error('objects db unavailable');
		};

		await checkAdminVersionCompatibility(adapter);

		expect(adapter._errors).to.have.lengthOf(0);
	});
});

describe('buildInfluxUrl', () => {
	it('appends the port to a URL without port', () => {
		expect(buildInfluxUrl('http://localhost', 8086)).to.equal('http://localhost:8086');
		expect(buildInfluxUrl('http://192.168.1.10/', '9999')).to.equal('http://192.168.1.10:9999/');
		expect(buildInfluxUrl('http://[::1]', 8086)).to.equal('http://[::1]:8086');
	});

	it('keeps an explicit port of the URL', () => {
		expect(buildInfluxUrl('http://localhost:8087', 8086)).to.equal('http://localhost:8087');
	});

	it('leaves the URL unchanged for an empty or invalid port', () => {
		expect(buildInfluxUrl('https://influx.example.com', 0)).to.equal('https://influx.example.com');
		expect(buildInfluxUrl('https://influx.example.com', '')).to.equal('https://influx.example.com');
		expect(buildInfluxUrl('https://influx.example.com', undefined)).to.equal('https://influx.example.com');
		expect(buildInfluxUrl('', 8086)).to.equal('');
	});

	it('is used by getInfluxConfig', () => {
		const cfg = getInfluxConfig({
			config: {
				influxUrl: ' http://host ',
				influxPort: 8086,
				influxOrg: 'o',
				influxBucket: 'b',
				influxToken: 't',
			},
		});
		expect(cfg).to.deep.equal({ url: 'http://host:8086', token: 't', org: 'o', bucket: 'b' });
	});
});
