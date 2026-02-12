/* eslint-disable jsdoc/require-jsdoc */
'use strict';

// Creates/extends ioBroker objects for this adapter.
// Goal: keep state/object boilerplate out of the runtime logic.

const { getItemOutputId } = require('./itemIds');

function getItemInfoBaseId(outputId) {
	return `items.${String(outputId)}`;
}

async function ensureChannelPath(adapter, id) {
	const raw = id ? String(id).trim() : '';
	if (!raw) {
		return;
	}
	const parts = raw.split('.').filter(Boolean);
	if (parts.length <= 1) {
		return;
	}

	let prefix = '';
	for (let i = 0; i < parts.length - 1; i++) {
		prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
		await adapter.setObjectNotExistsAsync(prefix, {
			type: 'channel',
			common: { name: parts[i] },
			native: {},
		});
	}
}

async function ensureOutputState(adapter, item) {
	const id = getItemOutputId(item);
	if (!id) {
		return;
	}

	await ensureChannelPath(adapter, id);

	const typeMap = {
		number: 'number',
		boolean: 'boolean',
		string: 'string',
		mixed: 'mixed',
	};
	const commonType = typeMap[item.type] || 'number';

	const obj = {
		type: 'state',
		common: {
			name: item.name || id,
			type: commonType,
			role: item.role || 'value',
			unit: item.unit || undefined,
			read: true,
			write: false,
		},
		native: {
			mode: item.mode || 'formula',
		},
	};

	const existing = await adapter.getObjectAsync(id);
	if (!existing) {
		await adapter.setObjectAsync(id, obj);
	} else {
		await adapter.extendObjectAsync(id, obj);
	}
}

async function ensureItemInfoStatesForCompiled(adapter, compiled) {
	if (!compiled || !compiled.outputId) {
		return;
	}
	const base = getItemInfoBaseId(compiled.outputId);

	await ensureChannelPath(adapter, `${base}.compiledOk`);

	await adapter.setObjectNotExistsAsync(`${base}.compiledOk`, {
		type: 'state',
		common: {
			name: 'Compiled OK',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.compileError`, {
		type: 'state',
		common: {
			name: 'Compile Error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.lastError`, {
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

	await adapter.setObjectNotExistsAsync(`${base}.lastOkTs`, {
		type: 'state',
		common: {
			name: 'Last OK Timestamp',
			type: 'string',
			role: 'date',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.lastEvalMs`, {
		type: 'state',
		common: {
			name: 'Last Evaluation Time (ms)',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
			unit: 'ms',
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync(`${base}.consecutiveErrors`, {
		type: 'state',
		common: {
			name: 'Consecutive Errors',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});
}

async function createInfoStates(adapter) {
	// === info.* (top-level status states) ===
	await adapter.setObjectNotExistsAsync('info.status', {
		type: 'state',
		common: {
			name: 'Status',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.itemsActive', {
		type: 'state',
		common: {
			name: 'Active items',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.lastError', {
		type: 'state',
		common: {
			name: 'Last error',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.lastRun', {
		type: 'state',
		common: {
			name: 'Last run',
			type: 'string',
			role: 'date',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.lastRunMs', {
		type: 'state',
		common: {
			name: 'Last run duration',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	// === info.diagnostics.* (diagnostics channel) ===
	await adapter.setObjectNotExistsAsync('info.diagnostics', {
		type: 'channel',
		common: { name: 'diagnostics' },
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.evalBudgetMs', {
		type: 'state',
		common: {
			name: 'Evaluation budget',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.evalSkipped', {
		type: 'state',
		common: {
			name: 'Skipped items (last tick)',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.itemsTotal', {
		type: 'state',
		common: {
			name: 'Total configured items',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	// === info.diagnostics.timing.* (timing sub-channel) ===
	await adapter.setObjectNotExistsAsync('info.diagnostics.timing', {
		type: 'channel',
		common: { name: 'timing' },
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.gapMs', {
		type: 'state',
		common: {
			name: 'Timestamp gap (all sources)',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.gapOk', {
		type: 'state',
		common: {
			name: 'Timestamp gap OK',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.gapActiveMs', {
		type: 'state',
		common: {
			name: 'Timestamp gap (active sources)',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.gapActiveOk', {
		type: 'state',
		common: {
			name: 'Timestamp gap (active) OK',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.newestAgeMs', {
		type: 'state',
		common: {
			name: 'Newest source age',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.newestId', {
		type: 'state',
		common: {
			name: 'Newest source ID',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.oldestAgeMs', {
		type: 'state',
		common: {
			name: 'Oldest source age',
			type: 'number',
			role: 'value',
			unit: 'ms',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.oldestId', {
		type: 'state',
		common: {
			name: 'Oldest source ID',
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.sources', {
		type: 'state',
		common: {
			name: 'Sources with timestamps',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.sourcesActive', {
		type: 'state',
		common: {
			name: 'Active sources',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	await adapter.setObjectNotExistsAsync('info.diagnostics.timing.sourcesSleeping', {
		type: 'state',
		common: {
			name: 'Sleeping sources',
			type: 'number',
			role: 'value',
			read: true,
			write: false,
		},
		native: {},
	});

	// Initialize all states with default values
	await adapter.setStateAsync('info.status', 'starting', true);
	await adapter.setStateAsync('info.itemsActive', 0, true);
	await adapter.setStateAsync('info.lastError', '', true);
	await adapter.setStateAsync('info.lastRun', '', true);
	await adapter.setStateAsync('info.lastRunMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.evalBudgetMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.evalSkipped', 0, true);
	await adapter.setStateAsync('info.diagnostics.itemsTotal', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.gapMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.gapOk', true, true);
	await adapter.setStateAsync('info.diagnostics.timing.gapActiveMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.gapActiveOk', true, true);
	await adapter.setStateAsync('info.diagnostics.timing.newestAgeMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.newestId', '', true);
	await adapter.setStateAsync('info.diagnostics.timing.oldestAgeMs', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.oldestId', '', true);
	await adapter.setStateAsync('info.diagnostics.timing.sources', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.sourcesActive', 0, true);
	await adapter.setStateAsync('info.diagnostics.timing.sourcesSleeping', 0, true);
}

module.exports = {
	getItemInfoBaseId,
	ensureChannelPath,
	ensureOutputState,
	ensureItemInfoStatesForCompiled,
	createInfoStates,
};
