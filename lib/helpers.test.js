'use strict';

/* global describe, it, beforeEach */

const { expect } = require('chai');
const { checkAdminVersionCompatibility } = require('./helpers');

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
