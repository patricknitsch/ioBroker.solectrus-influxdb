'use strict';

/*
 * Optional WebDAV storage for the backups of the Backup tab. Follows the WebDAV storage of
 * ioBroker.backitup (npm package "webdav", optional acceptance of self-signed certificates,
 * pruning of old remote backups): every new local backup is additionally uploaded to the
 * configured WebDAV directory, and the backups stored there can be listed, restored and deleted.
 */

const https = require('node:https');
const path = require('node:path');

const { BACKUP_EXT, IO_TIMEOUT_MS, withTimeout } = require('./backupManager');

const DEFAULT_KEEP_COUNT = 5;

let clientFactory = null;

/**
 * Replaces the WebDAV client factory (unit tests only).
 *
 * @param {((url: string, options: object) => object)|null} factory - Client factory, or null for the real "webdav" package.
 */
function _setClientFactory(factory) {
	clientFactory = factory;
}

function toBool(value, fallback) {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	return value === true || value === 'true';
}

/**
 * WebDAV settings to use. Like the backup directory (see backupManager.getBackupDir), the
 * frontend sends the values the still-open config dialog currently shows, so actions honor
 * unsaved edits; without them the persisted config is used.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} [override] - WebDAV settings sent by the frontend, if given.
 * @returns {{enabled: boolean, url: string, username: string, password: string, dir: string, signedCertificates: boolean, deleteOldBackup: boolean}} Normalized settings.
 */
function getWebdavConfig(adapter, override) {
	const cfg = adapter.config || {};
	const src =
		override && typeof override === 'object'
			? override
			: {
					enabled: cfg.webdavEnabled,
					url: cfg.webdavURL,
					username: cfg.webdavUsername,
					password: cfg.webdavPassword,
					dir: cfg.webdavDir,
					signedCertificates: cfg.webdavSignedCertificates,
					deleteOldBackup: cfg.webdavDeleteOldBackup,
				};
	return {
		enabled: toBool(src.enabled, false),
		url: String(src.url || '').trim(),
		username: String(src.username || ''),
		password: String(src.password || ''),
		dir: String(src.dir || ''),
		signedCertificates: toBool(src.signedCertificates, true),
		deleteOldBackup: toBool(src.deleteOldBackup, true),
	};
}

/**
 * Whether new backups are uploaded to WebDAV.
 *
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @returns {boolean} True when enabled and a URL is set.
 */
function isActive(webdavCfg) {
	return !!(webdavCfg && webdavCfg.enabled && webdavCfg.url);
}

/**
 * Remote directory as an absolute path with forward slashes (as in backitup).
 *
 * @param {string} dir - Configured directory.
 * @returns {string} Normalized directory.
 */
function normalizeDir(dir) {
	let result = String(dir || '')
		.trim()
		.replace(/\\/g, '/');
	if (!result || result[0] !== '/') {
		result = `/${result}`;
	}
	return result;
}

function remotePath(webdavCfg, fileName) {
	return path.posix.join(normalizeDir(webdavCfg.dir), fileName);
}

function sanitizeRemoteName(fileName) {
	const base = path.basename(String(fileName || ''));
	if (!base || base !== fileName || !base.endsWith(BACKUP_EXT)) {
		throw new Error('Invalid backup file name');
	}
	return base;
}

async function createWebdavClient(webdavCfg) {
	if (!webdavCfg.url) {
		throw new Error('No WebDAV URL configured');
	}
	const options = {
		username: webdavCfg.username,
		password: webdavCfg.password,
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
		httpsAgent: new https.Agent({ rejectUnauthorized: webdavCfg.signedCertificates }),
	};
	if (clientFactory) {
		return clientFactory(webdavCfg.url, options);
	}
	// "webdav" ships as ESM only, so it has to be loaded with a dynamic import
	const { createClient } = await import('webdav');
	return createClient(webdavCfg.url, options);
}

function guard(adapter, webdavCfg, promise) {
	return withTimeout(promise, webdavCfg.url, IO_TIMEOUT_MS, adapter);
}

/**
 * Lists the backups stored in the WebDAV directory, most recent first.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @returns {Promise<Array<{fileName: string, size: number, mtime: number}>>} Backup file metadata.
 */
async function listRemoteBackups(adapter, webdavCfg) {
	const client = await createWebdavClient(webdavCfg);
	const dir = normalizeDir(webdavCfg.dir);
	if (!(await guard(adapter, webdavCfg, client.exists(dir)))) {
		return [];
	}
	const contents = (await guard(adapter, webdavCfg, client.getDirectoryContents(dir))) || [];
	return contents
		.filter(item => item && item.type === 'file' && String(item.basename || '').endsWith(BACKUP_EXT))
		.map(item => ({
			fileName: item.basename,
			size: Number(item.size) || 0,
			mtime: new Date(item.lastmod).getTime() || 0,
		}))
		.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Uploads a backup file to the WebDAV directory (created if missing) and, if enabled,
 * deletes all but the newest `backupKeepCount` remote backups.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @param {string} fileName - Backup file name.
 * @param {Buffer} content - Backup file content.
 * @returns {Promise<void>}
 */
async function uploadBackup(adapter, webdavCfg, fileName, content) {
	const safeName = sanitizeRemoteName(fileName);
	const client = await createWebdavClient(webdavCfg);
	const dir = normalizeDir(webdavCfg.dir);
	if (dir !== '/' && !(await guard(adapter, webdavCfg, client.exists(dir)))) {
		await guard(adapter, webdavCfg, client.createDirectory(dir, { recursive: true }));
	}
	await guard(
		adapter,
		webdavCfg,
		client.putFileContents(remotePath(webdavCfg, safeName), content, {
			overwrite: true,
			contentLength: content.length,
		}),
	);

	if (webdavCfg.deleteOldBackup) {
		const keepCount =
			Number.isFinite(adapter.config && adapter.config.backupKeepCount) && adapter.config.backupKeepCount > 0
				? adapter.config.backupKeepCount
				: DEFAULT_KEEP_COUNT;
		const backups = await listRemoteBackups(adapter, webdavCfg);
		for (const old of backups.slice(keepCount)) {
			try {
				await guard(adapter, webdavCfg, client.deleteFile(remotePath(webdavCfg, old.fileName)));
			} catch (err) {
				adapter.log.debug(`Could not prune old WebDAV backup "${old.fileName}": ${err}`);
			}
		}
	}
}

/**
 * Downloads a backup file from the WebDAV directory.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @param {string} fileName - Backup file name as returned by {@link listRemoteBackups}.
 * @returns {Promise<Buffer>} The file content.
 */
async function downloadBackup(adapter, webdavCfg, fileName) {
	const safeName = sanitizeRemoteName(fileName);
	const client = await createWebdavClient(webdavCfg);
	const data = await guard(
		adapter,
		webdavCfg,
		client.getFileContents(remotePath(webdavCfg, safeName), { format: 'binary' }),
	);
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/**
 * Deletes a backup file from the WebDAV directory.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @param {string} fileName - Backup file name as returned by {@link listRemoteBackups}.
 * @returns {Promise<void>}
 */
async function deleteBackup(adapter, webdavCfg, fileName) {
	const safeName = sanitizeRemoteName(fileName);
	const client = await createWebdavClient(webdavCfg);
	await guard(adapter, webdavCfg, client.deleteFile(remotePath(webdavCfg, safeName)));
}

/**
 * Checks that the WebDAV server is reachable with the given credentials.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {object} webdavCfg - Settings from {@link getWebdavConfig}.
 * @returns {Promise<void>}
 */
async function testConnection(adapter, webdavCfg) {
	const client = await createWebdavClient(webdavCfg);
	await guard(adapter, webdavCfg, client.getDirectoryContents('/'));
}

module.exports = {
	_setClientFactory,
	getWebdavConfig,
	isActive,
	normalizeDir,
	listRemoteBackups,
	uploadBackup,
	downloadBackup,
	deleteBackup,
	testConnection,
};
