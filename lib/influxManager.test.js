'use strict';

/* global describe, it */

const { expect } = require('chai');
const { getCredentialInfluxValues, applyInfluxCredential } = require('./influxManager');

function makeAdapter(config, credentialObj) {
	const logs = { info: [], warn: [] };
	return {
		config,
		log: { info: msg => logs.info.push(msg), warn: msg => logs.warn.push(msg), debug: () => {} },
		getForeignObjectAsync: async () => credentialObj,
		decrypt: value => `dec(${value})`,
		_logs: logs,
	};
}

describe('getCredentialInfluxValues', () => {
	it('uses the key as token', () => {
		expect(getCredentialInfluxValues({ key: ' abc ' })).to.deep.equal({ url: '', token: 'abc' });
	});

	it('uses login as URL and password as token', () => {
		expect(getCredentialInfluxValues({ login: 'http://influx', password: 'pw' })).to.deep.equal({
			url: 'http://influx',
			token: 'pw',
		});
	});
});

describe('applyInfluxCredential', () => {
	it('does nothing without a selected credential', async () => {
		const config = { influxCredential: '', influxUrl: 'http://manual', influxToken: 'manual' };
		expect(await applyInfluxCredential(makeAdapter(config))).to.equal(null);
		expect(config).to.include({ influxUrl: 'http://manual', influxToken: 'manual' });
	});

	it('takes the token of a key credential and keeps the URL field', async () => {
		const config = { influxCredential: 'system.credentials.influx', influxUrl: 'http://manual', influxToken: '' };
		const obj = {
			_id: 'system.credentials.influx',
			common: { name: 'Influx' },
			native: { type: 'custom', form: 'key', encryptedFields: ['key'], key: 'secret' },
		};
		const result = await applyInfluxCredential(makeAdapter(config, obj));
		expect(result).to.deep.equal({ url: '', token: 'dec(secret)' });
		expect(config).to.include({ influxUrl: 'http://manual', influxToken: 'dec(secret)' });
	});

	it('takes URL and token of a login credential', async () => {
		const config = { influxCredential: 'system.credentials.influx', influxUrl: 'http://manual', influxToken: '' };
		const obj = {
			_id: 'system.credentials.influx',
			common: { name: 'Influx' },
			native: { form: 'login', encryptedFields: ['password'], login: 'http://influx', password: 'pw' },
		};
		await applyInfluxCredential(makeAdapter(config, obj));
		expect(config).to.include({ influxUrl: 'http://influx', influxToken: 'dec(pw)' });
	});

	it('falls back to the instance settings if the credential is missing', async () => {
		const config = {
			influxCredential: 'system.credentials.gone',
			influxUrl: 'http://manual',
			influxToken: 'manual',
		};
		const adapter = makeAdapter(config, null);
		expect(await applyInfluxCredential(adapter)).to.equal(null);
		expect(config).to.include({ influxUrl: 'http://manual', influxToken: 'manual' });
		expect(adapter._logs.warn).to.have.lengthOf(1);
	});
});
