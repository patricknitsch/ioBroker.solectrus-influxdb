'use strict';

const { getCalcConfig } = require('./config');
const { validateCalcConfig } = require('./validator');
const { createAlignedScheduler } = require('./scheduler');
const { readSnapshot } = require('./snapshot');
const { evaluateItem } = require('./evaluator');
const { postprocess } = require('./postprocess');
const { ensureCalcObjects, writeCalcState } = require('./stateWriter');

/**
 * @param {import('@iobroker/adapter-core').AdapterInstance} adapter
 * @param {(entry: {id:string, measurement:string, field:string, type:'int'|'float'|'bool'|'string', value:any, ts:number}) => void} pushToBuffer
 */
function createCalcEngine(adapter, pushToBuffer) {
	let scheduler = null;

	function start(nativeConfig) {
		const cfg = getCalcConfig(nativeConfig);
		if (!cfg.enabled) {
			adapter.log.info('[calc] disabled');
			return;
		}

		const v = validateCalcConfig(cfg);
		if (!v.ok) {
			adapter.log.error(`[calc] invalid config:\n${v.errors.map(e => `- ${e}`).join('\n')}`);
			return;
		}

		adapter.log.info(
			`[calc] enabled (interval=${cfg.intervalSec}s, snapshot=${cfg.snapshot}, writeStates=${cfg.writeStates})`,
		);

		if (cfg.writeStates) {
			ensureCalcObjects(adapter, cfg).catch(e => adapter.log.warn(`[calc] ensure objects: ${e?.message || e}`));
		}

		// wall-clock aligned scheduler
		scheduler = createAlignedScheduler(cfg.intervalSec, async tickMs => {
			try {
				const tickTs = tickMs;

				let snapshot = null;
				if (cfg.snapshot) {
					snapshot = await readSnapshot(adapter, cfg, cfg.snapshotDelayMs);
				}

				for (const item of cfg.items) {
					if (!item.enabled) {
						continue;
					}

					try {
						const raw = await evaluateItem(adapter, item, snapshot);
						const value = postprocess(item, raw);

						if (cfg.writeStates) {
							await writeCalcState(adapter, cfg, item, value, tickTs);
						}

						if (value !== null && value !== undefined) {
							pushToBuffer({
								id: item.targetId,
								measurement: item.measurement,
								field: item.field,
								type: item.type,
								value,
								ts: tickTs,
							});
						}
					} catch (e) {
						adapter.log.warn(`[calc] item '${item.targetId}' failed: ${e?.message || e}`);
					}
				}
			} catch (e) {
				adapter.log.warn(`[calc] tick failed: ${e?.message || e}`);
			}
		});

		scheduler.start();
	}

	function stop() {
		if (scheduler) {
			scheduler.stop();
			scheduler = null;
		}
	}

	return { start, stop };
}

module.exports = { createCalcEngine };
