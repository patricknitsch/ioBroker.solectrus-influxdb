/* eslint-disable jsdoc/require-jsdoc */
'use strict';

function createAlignedScheduler(intervalSec, onTick) {
	let timer = null;
	let running = false;

	function nextBoundaryMs(nowMs) {
		const intervalMs = intervalSec * 1000;
		return nowMs - (nowMs % intervalMs) + intervalMs;
	}

	function scheduleNext() {
		if (!running) {
			return;
		}

		const now = Date.now();
		const next = nextBoundaryMs(now);
		const delay = Math.max(0, next - now);

		timer = setTimeout(async () => {
			// tick at boundary
			const tick = Date.now() - (Date.now() % (intervalSec * 1000));
			try {
				await onTick(tick);
			} finally {
				scheduleNext();
			}
		}, delay);
	}

	function start() {
		if (running) {
			return;
		}
		running = true;
		scheduleNext();
	}

	function stop() {
		running = false;
		if (timer) {
			clearTimeout(timer);
		}
		timer = null;
	}

	return { start, stop };
}

module.exports = { createAlignedScheduler };
