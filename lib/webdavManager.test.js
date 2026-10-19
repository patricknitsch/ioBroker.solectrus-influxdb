'use strict';

/* global describe, it, beforeEach, afterEach */

const { expect } = require('chai');

const webdavManager = require('./webdavManager');

const EXT = '.solectrusbackup.json.gz';

/**
 * In-memory stand-in for a client of the "webdav" package.
 *
 * @returns {object} Fake client with its file map exposed as `files`.
 */
function makeFakeClient() {
	const files = new Map(); // path -> { content, lastmod }
	const dirs = new Set(['/']);
	const calls = [];
	let tick = 0;
	return {
		files,
		dirs,
		calls,
		exists: async p => dirs.has(p) || files.has(p),
		createDirectory: async p => {
			calls.push(['createDirectory', p]);
			dirs.add(p);
		},
		getDirectoryContents: async dir => {
			calls.push(['getDirectoryContents', dir]);
			const out = [];
			for (const [p, f] of files) {
				if (p.startsWith(`${dir === '/' ? '' : dir}/`)) {
					out.push({
						filename: p,
						basename: p.split('/').pop(),
						type: 'file',
						size: f.content.length,
						lastmod: f.lastmod,
					});
				}
			}
			out.push({ filename: `${dir}/sub`, basename: 'sub', type: 'directory', size: 0, lastmod: '' });
			return out;
		},
		putFileContents: async (p, content) => {
			tick++;
			files.set(p, { content, lastmod: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toUTCString() });
			return true;
		},
		getFileContents: async p => {
			if (!files.has(p)) {
				throw new Error('404');
			}
			return files.get(p).content;
		},
		deleteFile: async p => {
			calls.push(['deleteFile', p]);
			files.delete(p);
		},
	};
}

function makeAdapter(config) {
	return {
		config: config || {},
		log: { warn: () => {}, debug: () => {}, info: () => {} },
	};
}

describe('webdavManager', () => {
	let client;
	let factoryArgs;

	beforeEach(() => {
		client = makeFakeClient();
		factoryArgs = null;
		webdavManager._setClientFactory((url, options) => {
			factoryArgs = { url, options };
			return client;
		});
	});

	afterEach(() => webdavManager._setClientFactory(null));

	describe('getWebdavConfig', () => {
		it('reads the persisted config', () => {
			const cfg = webdavManager.getWebdavConfig(
				makeAdapter({
					webdavEnabled: true,
					webdavURL: ' https://dav.example/ ',
					webdavUsername: 'u',
					webdavPassword: 'p',
					webdavDir: '/x',
					webdavSignedCertificates: false,
					webdavDeleteOldBackup: false,
				}),
			);
			expect(cfg).to.deep.equal({
				enabled: true,
				url: 'https://dav.example/',
				username: 'u',
				password: 'p',
				dir: '/x',
				signedCertificates: false,
				deleteOldBackup: false,
			});
		});

		it('prefers the values sent by the frontend and accepts string booleans', () => {
			const cfg = webdavManager.getWebdavConfig(makeAdapter({ webdavEnabled: false, webdavURL: 'old' }), {
				enabled: 'true',
				url: 'https://new/',
				signedCertificates: 'false',
			});
			expect(cfg.enabled).to.equal(true);
			expect(cfg.url).to.equal('https://new/');
			expect(cfg.signedCertificates).to.equal(false);
			expect(cfg.deleteOldBackup).to.equal(true);
		});

		it('is only active when enabled and a URL is set', () => {
			expect(webdavManager.isActive({ enabled: true, url: '' })).to.equal(false);
			expect(webdavManager.isActive({ enabled: false, url: 'https://x/' })).to.equal(false);
			expect(webdavManager.isActive({ enabled: true, url: 'https://x/' })).to.equal(true);
		});
	});

	it('normalizes the remote directory', () => {
		expect(webdavManager.normalizeDir('')).to.equal('/');
		expect(webdavManager.normalizeDir('backups\\solectrus')).to.equal('/backups/solectrus');
		expect(webdavManager.normalizeDir('/a')).to.equal('/a');
	});

	it('passes credentials and the certificate option to the client', async () => {
		const cfg = { url: 'https://dav.example/', username: 'u', password: 'p', dir: '/', signedCertificates: false };
		await webdavManager.testConnection(makeAdapter(), cfg);
		expect(factoryArgs.url).to.equal('https://dav.example/');
		expect(factoryArgs.options.username).to.equal('u');
		expect(factoryArgs.options.password).to.equal('p');
		expect(factoryArgs.options.httpsAgent.options.rejectUnauthorized).to.equal(false);
	});

	it('uploads into the (created) directory, lists, downloads and deletes backups', async () => {
		const adapter = makeAdapter();
		const cfg = { url: 'https://dav.example/', dir: 'solectrus', signedCertificates: true, deleteOldBackup: false };
		const name = `solectrus-influxdb_0_a${EXT}`;

		await webdavManager.uploadBackup(adapter, cfg, name, Buffer.from('abc'));
		expect(client.calls).to.deep.include(['createDirectory', '/solectrus']);
		expect(client.files.has(`/solectrus/${name}`)).to.equal(true);

		const list = await webdavManager.listRemoteBackups(adapter, cfg);
		expect(list.map(b => b.fileName)).to.deep.equal([name]);
		expect(list[0].size).to.equal(3);

		const buf = await webdavManager.downloadBackup(adapter, cfg, name);
		expect(buf.toString()).to.equal('abc');

		await webdavManager.deleteBackup(adapter, cfg, name);
		expect(await webdavManager.listRemoteBackups(adapter, cfg)).to.deep.equal([]);
	});

	it('returns an empty list when the directory does not exist yet', async () => {
		const list = await webdavManager.listRemoteBackups(makeAdapter(), { url: 'https://x/', dir: '/missing' });
		expect(list).to.deep.equal([]);
	});

	it('keeps only the newest backupKeepCount remote backups when pruning is enabled', async () => {
		const adapter = makeAdapter({ backupKeepCount: 2 });
		const cfg = { url: 'https://x/', dir: '/b', deleteOldBackup: true };
		for (const n of ['1', '2', '3']) {
			await webdavManager.uploadBackup(adapter, cfg, `bk${n}${EXT}`, Buffer.from(n));
		}
		const list = await webdavManager.listRemoteBackups(adapter, cfg);
		expect(list.map(b => b.fileName)).to.deep.equal([`bk3${EXT}`, `bk2${EXT}`]);
	});

	it('rejects file names that are not plain backup file names', async () => {
		const cfg = { url: 'https://x/', dir: '/b' };
		for (const bad of ['../evil.solectrusbackup.json.gz', 'a/b.solectrusbackup.json.gz', 'x.txt']) {
			let err;
			try {
				await webdavManager.downloadBackup(makeAdapter(), cfg, bad);
			} catch (e) {
				err = e;
			}
			expect(err, bad).to.be.an('error');
		}
	});

	it('fails without a URL', async () => {
		let err;
		try {
			await webdavManager.testConnection(makeAdapter(), { url: '' });
		} catch (e) {
			err = e;
		}
		expect(err).to.be.an('error');
	});
});
