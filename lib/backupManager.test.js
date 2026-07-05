'use strict';

/* global describe, it, beforeEach, afterEach */

const { expect } = require('chai');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const backupManager = require('./backupManager');

function makeAdapter(adapterDir, overrides) {
	const objects = {};
	const instanceObject = {
		_id: 'system.adapter.solectrus-influxdb.0',
		type: 'instance',
		native: {
			influxUrl: 'http://localhost:8086',
			influxToken: 'super-secret-token',
			sensors: [{ enabled: true, SensorName: 'HOUSE_POWER' }],
		},
	};

	return Object.assign(
		{
			namespace: 'solectrus-influxdb.0',
			adapterDir,
			config: {},
			log: { warn: () => {}, debug: () => {}, info: () => {} },
			getForeignObjectAsync: async id => (id === 'system.adapter.solectrus-influxdb.0' ? instanceObject : null),
			getForeignObjectsAsync: async () => objects,
			setObjectAsync: async (id, obj) => {
				objects[id] = obj;
			},
			_objects: objects,
		},
		overrides,
	);
}

describe('backupManager', () => {
	let adapterDir;

	beforeEach(async () => {
		adapterDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'solectrus-backup-test-'));
	});

	afterEach(async () => {
		await fsp.rm(adapterDir, { recursive: true, force: true });
	});

	it('creates a backup file excluding protected native keys, and lists it', async () => {
		const adapter = makeAdapter(adapterDir);
		adapter._objects['solectrus-influxdb.0.HOUSE_POWER'] = {
			_id: 'solectrus-influxdb.0.HOUSE_POWER',
			type: 'state',
			common: {},
		};

		const fileName = await backupManager.createBackup(adapter);
		expect(fs.existsSync(path.join(backupManager.getBackupDir(adapter), fileName))).to.equal(true);

		const backups = await backupManager.listBackups(adapter);
		expect(backups.map(b => b.fileName)).to.deep.equal([fileName]);

		const raw = await fsp.readFile(path.join(backupManager.getBackupDir(adapter), fileName));
		const payload = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
		expect(payload.adapter).to.equal('solectrus-influxdb');
		expect(payload.instanceNative).to.not.have.property('influxToken');
		expect(payload.instanceNative.influxUrl).to.equal('http://localhost:8086');
		expect(payload.objects).to.have.property('solectrus-influxdb.0.HOUSE_POWER');
	});

	it('honors a custom backup directory (absolute and relative)', async () => {
		const customDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'solectrus-backup-custom-'));
		const adapter = makeAdapter(adapterDir, { config: { backupDir: customDir } });

		expect(backupManager.getBackupDir(adapter)).to.equal(customDir);
		const fileName = await backupManager.createBackup(adapter);
		expect(fs.existsSync(path.join(customDir, fileName))).to.equal(true);
		expect(fs.existsSync(path.join(adapterDir, 'backups', fileName))).to.equal(false);

		const relativeAdapter = makeAdapter(adapterDir, { config: { backupDir: 'my-backups' } });
		expect(backupManager.getBackupDir(relativeAdapter)).to.equal(path.join(adapterDir, 'my-backups'));

		await fsp.rm(customDir, { recursive: true, force: true });
	});

	it('restores objects and returns the instance native config without the token', async () => {
		const adapter = makeAdapter(adapterDir);
		adapter._objects['solectrus-influxdb.0.HOUSE_POWER'] = {
			_id: 'solectrus-influxdb.0.HOUSE_POWER',
			type: 'state',
			common: {},
		};
		const fileName = await backupManager.createBackup(adapter);

		const restoreAdapter = makeAdapter(adapterDir);
		const result = await backupManager.restoreBackup(restoreAdapter, fileName);

		expect(result.restoredCount).to.equal(1);
		expect(restoreAdapter._objects).to.have.property('solectrus-influxdb.0.HOUSE_POWER');
		expect(result.instanceNative).to.not.have.property('influxToken');
	});

	it('keeps only the configured number of most recent backups', async () => {
		const adapter = makeAdapter(adapterDir, { config: { backupKeepCount: 2 } });

		const fileNames = [];
		for (let i = 0; i < 3; i++) {
			fileNames.push(await backupManager.createBackup(adapter));
			await new Promise(resolve => setTimeout(resolve, 5));
		}

		const backups = await backupManager.listBackups(adapter);
		expect(backups).to.have.lengthOf(2);
		expect(backups.map(b => b.fileName)).to.not.include(fileNames[0]);
	});

	it('round-trips an uploaded backup and rejects invalid content', async () => {
		const adapter = makeAdapter(adapterDir);
		const fileName = await backupManager.createBackup(adapter);
		const base64 = await backupManager.readBackupBase64(adapter, fileName);

		const uploadedName = await backupManager.saveUploadedBackup(adapter, 'my-upload.tar.gz', base64);
		expect(uploadedName.endsWith(backupManager.BACKUP_EXT)).to.equal(true);

		await backupManager.deleteBackup(adapter, uploadedName);
		const backups = await backupManager.listBackups(adapter);
		expect(backups.map(b => b.fileName)).to.not.include(uploadedName);

		let rejected = false;
		try {
			await backupManager.saveUploadedBackup(adapter, 'bad.gz', Buffer.from('not a backup').toString('base64'));
		} catch {
			rejected = true;
		}
		expect(rejected).to.equal(true);
	});

	it('times out instead of hanging forever on an unresponsive backup directory', async () => {
		const neverResolves = new Promise(() => {});

		let rejected = null;
		try {
			await backupManager.withTimeout(neverResolves, '/some/unreachable/mount', 20);
		} catch (e) {
			rejected = e;
		}

		expect(rejected).to.not.equal(null);
		expect(rejected.message).to.include('/some/unreachable/mount');
	});

	it('rejects path traversal attempts in file names', async () => {
		const adapter = makeAdapter(adapterDir);

		let rejected = false;
		try {
			await backupManager.deleteBackup(adapter, `../../etc/passwd${backupManager.BACKUP_EXT}`);
		} catch {
			rejected = true;
		}
		expect(rejected).to.equal(true);
	});
});
