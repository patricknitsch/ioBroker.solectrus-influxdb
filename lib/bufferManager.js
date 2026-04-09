'use strict';

const fs = require('node:fs');

/**
 * Clears the in-memory buffer and persists the empty buffer to disk.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
async function clearBuffer(adapter) {
	adapter.log.info('Clear Buffer...');
	adapter.buffer = [];
	try {
		saveBuffer(adapter);
		adapter.log.info('Buffer successfully cleared');
	} catch (err) {
		adapter.log.error(`Error at clearing Buffer: ${err.message}`);
	}
	updateBufferStates(adapter);
}

/**
 * Loads the persisted buffer from disk into the adapter's in-memory buffer.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
function loadBuffer(adapter) {
	try {
		if (fs.existsSync(adapter.bufferFile)) {
			adapter.buffer = JSON.parse(fs.readFileSync(adapter.bufferFile, 'utf8')) || [];
			adapter.log.info(`Loaded ${adapter.buffer.length} buffered points`);
		}
	} catch (err) {
		adapter.log.error(`Failed to load buffer: ${err.message}`);
		adapter.buffer = [];
	}
}

/**
 * Persists the current in-memory buffer to disk as JSON.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
function saveBuffer(adapter) {
	try {
		fs.writeFileSync(adapter.bufferFile, JSON.stringify(adapter.buffer));
	} catch (err) {
		adapter.log.error(`Failed to save buffer: ${err.message}`);
	}
}

/**
 * Updates the ioBroker states that reflect the current buffer size and oldest entry timestamp.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 */
function updateBufferStates(adapter) {
	adapter.setState('info.buffer.size', adapter.buffer.length, true);
	if (adapter.buffer.length > 0) {
		adapter.setState('info.buffer.oldest', new Date(adapter.buffer[0].ts).toISOString(), true);
	} else {
		// optional: clear oldest when empty
		adapter.setState('info.buffer.oldest', '', true);
	}
}

module.exports = { clearBuffer, loadBuffer, saveBuffer, updateBufferStates };
