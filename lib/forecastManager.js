'use strict';

const { getForecastStateId, parseJsonArray, parseTimestamp, parseInfluxValue } = require('./helpers');
const { saveBuffer, updateBufferStates } = require('./bufferManager');

async function prepareForecastSources(adapter) {
	if (!adapter.config.enableForecast || !Array.isArray(adapter.config.forecasts)) {
		return;
	}

	for (const fc of adapter.config.forecasts) {
		if (adapter.isUnloading) {
			break;
		}
		if (!fc || !fc.enabled || !fc.sourceState) {
			continue;
		}

		// Create ioBroker channel for this forecast entry
		const channelId = getForecastStateId(fc);
		await adapter.setObjectNotExistsAsync(channelId, {
			type: 'channel',
			common: {
				name: fc.name || 'Forecast',
			},
			native: {
				sourceState: fc.sourceState,
				valField: fc.valField || 'y',
				measurement: fc.measurement,
				field: fc.field,
			},
		});

		if (!adapter.forecastSourceMap[fc.sourceState]) {
			adapter.forecastSourceMap[fc.sourceState] = [];
		}
		adapter.forecastSourceMap[fc.sourceState].push(fc);
	}

	const sourceStates = Object.keys(adapter.forecastSourceMap);
	if (sourceStates.length === 0) {
		return;
	}

	adapter.log.info(`Forecast: subscribing to ${sourceStates.length} JSON source(s)`);
	for (const stateId of sourceStates) {
		adapter.subscribeForeignStates(stateId);
	}
}

function formatForecastTimestamp(tsMs) {
	const d = new Date(tsMs);
	const pad = (n, len) => String(n).padStart(len || 2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function processForecastJson(adapter, sourceState, jsonVal) {
	const mappings = adapter.forecastSourceMap[sourceState];
	if (!mappings || mappings.length === 0) {
		return;
	}

	const data = parseJsonArray(adapter, jsonVal, sourceState);
	if (!data) {
		return;
	}

	let totalPoints = 0;
	const typeMapping = { int: 'number', float: 'number' };
	const stateUpdates = [];

	for (const fc of mappings) {
		const tsField = fc.tsField || 't';
		const valField = fc.valField || 'y';
		const channelId = getForecastStateId(fc);
		const iobType = typeMapping[fc.type] || 'number';

		for (const entry of data) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}

			const rawTs = entry[tsField];
			const rawVal = entry[valField];
			if (rawTs == null || rawVal == null) {
				continue;
			}

			const ts = parseTimestamp(rawTs);
			if (!Number.isFinite(ts)) {
				adapter.log.debug(`Forecast: invalid timestamp ${rawTs} in ${sourceState}`);
				continue;
			}

			const value = parseInfluxValue(rawVal, fc.type);
			if (Number.isNaN(value)) {
				continue;
			}

			adapter.buffer.push({
				id: fc.name || 'forecast',
				measurement: fc.measurement,
				field: fc.field,
				type: fc.type,
				value,
				ts,
			});
			totalPoints++;

			// Collect state update (created non-blocking below)
			const tsName = formatForecastTimestamp(ts);
			stateUpdates.push({
				stateId: `${channelId}.${tsName}`,
				name: `${fc.name || 'Forecast'} ${new Date(ts).toLocaleString()}`,
				iobType,
				value,
			});
		}
	}

	if (totalPoints > 0) {
		adapter.log.info(`Forecast: buffered ${totalPoints} points from ${sourceState}`);

		if (adapter.buffer.length > adapter.maxBufferSize) {
			adapter.log.warn('Buffer limit reached – dropping oldest entries');
			adapter.buffer.splice(0, adapter.buffer.length - adapter.maxBufferSize);
		}

		saveBuffer(adapter);
		updateBufferStates(adapter);

		// Trigger immediate flush
		if (!adapter.isFlushing) {
			adapter.scheduleNextFlush(0);
		}
	}

	// Create/update ioBroker states non-blocking – never stalls ds tick
	if (stateUpdates.length > 0) {
		updateForecastStates(adapter, stateUpdates).catch(err => {
			adapter.log.debug(`Forecast state updates failed: ${err.message}`);
		});
	}
}

async function updateForecastStates(adapter, stateUpdates) {
	for (const upd of stateUpdates) {
		if (adapter.isUnloading) {
			break;
		}
		try {
			await adapter.setObjectNotExistsAsync(upd.stateId, {
				type: 'state',
				common: {
					name: upd.name,
					type: upd.iobType,
					role: 'value',
					read: true,
					write: false,
				},
				native: {},
			});
			adapter.setState(upd.stateId, upd.value, true);
		} catch (err) {
			const msg = err && err.message ? err.message : String(err);
			if (/connection is closed|db closed/i.test(msg)) {
				adapter.log.warn(
					`Forecast state updates aborted (connection lost) after ${upd.stateId}. Remaining updates skipped.`,
				);
				break;
			}
			adapter.log.debug(`Forecast state update failed for ${upd.stateId}: ${msg}`);
		}
	}
}

module.exports = { prepareForecastSources, formatForecastTimestamp, processForecastJson, updateForecastStates };
