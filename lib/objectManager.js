'use strict';

async function ensureObjectTree(adapter) {
	// info channel
	await adapter.setObjectNotExistsAsync('info', {
		type: 'channel',
		common: { name: 'Info' },
		native: {},
	});

	// buffer channel
	await adapter.setObjectNotExistsAsync('info.buffer', {
		type: 'channel',
		common: { name: 'Buffer' },
		native: {},
	});

	// sensors channel
	await adapter.setObjectNotExistsAsync('sensors', {
		type: 'channel',
		common: { name: 'Sensors' },
		native: {},
	});
}

async function createInfoStates(adapter) {
	await adapter.setObjectNotExistsAsync('info.connection', {
		type: 'state',
		common: {
			name: 'Device or service connected',
			type: 'boolean',
			role: 'indicator.connected',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.size', {
		type: 'state',
		common: {
			name: 'Buffered points',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.oldest', {
		type: 'state',
		common: {
			name: 'Oldest buffered timestamp',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.buffer.clear', {
		type: 'state',
		common: {
			name: 'Clear Buffer manually',
			type: 'boolean',
			role: 'button',
			read: false,
			write: true,
		},
		native: {},
	});
	adapter.subscribeStates('info.buffer.clear');

	await adapter.setObjectNotExistsAsync('info.lastError', {
		type: 'state',
		common: {
			name: 'Last Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});
}

async function ensureDefaultSensorsAndTitles(adapter) {
	try {
		const objId = `system.adapter.${adapter.namespace}`;
		const obj = await adapter.getForeignObjectAsync(objId);
		if (!obj || !obj.native || !Array.isArray(obj.native.sensors)) {
			return;
		}

		let changed = false;

		// Mark first-install flag (defaults come from io-package.json via ioBroker)
		if (!obj.native._defaultSensorsCreated) {
			obj.native._defaultSensorsCreated = true;
			changed = true;
		}

		// Migration: enable Data-SOLECTRUS formula engine by default for existing instances
		// Only applies when the field was never explicitly saved (undefined = old install
		// that pre-dates the checkbox).  An explicit false (user disabled it) is preserved.
		if (obj.native.enableDataSolectrus === undefined || obj.native.enableDataSolectrus === null) {
			obj.native.enableDataSolectrus = true;
			adapter.config.enableDataSolectrus = true;
			changed = true;
		}

		// --- Sensor titles ---
		for (const sensor of obj.native.sensors) {
			if (!sensor || typeof sensor !== 'object') {
				continue;
			}
			const sensorName = sensor.SensorName || 'Sensor';
			const expectedTitle = `${sensor.enabled ? '🟢 ' : '⚪ '}${sensorName}`;
			if (sensor._title !== expectedTitle) {
				sensor._title = expectedTitle;
				changed = true;
			}
		}

		if (changed) {
			await adapter.setForeignObject(objId, obj);
			adapter.config.sensors = obj.native.sensors;
		}
	} catch (e) {
		adapter.log.warn(`Cannot ensure default sensors / titles: ${e}`);
	}
}

module.exports = { ensureObjectTree, createInfoStates, ensureDefaultSensorsAndTitles };
