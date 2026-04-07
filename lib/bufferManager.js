'use strict';

const fs = require('node:fs');

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

function saveBuffer(adapter) {
	try {
		fs.writeFileSync(adapter.bufferFile, JSON.stringify(adapter.buffer));
	} catch (err) {
		adapter.log.error(`Failed to save buffer: ${err.message}`);
	}
}

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
