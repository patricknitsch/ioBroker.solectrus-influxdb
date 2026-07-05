/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Minimal Module Federation remote container for ioBroker Admin jsonConfig "custom" control.
// Exposes: SolectrusBackup/Components -> default export is an object containing { SolectrusBackupEditor }.
// Lets the user create/upload/restore/download/delete local backups of this adapter instance
// (instance config, sensors, Data-SOLECTRUS items and the object tree) without needing the
// separate ioBroker.backitup adapter installed.
(function () {
	'use strict';

	const REMOTE_NAME = 'SolectrusBackup';
	const UI_VERSION = '2026-07-05 20260705-1';
	let shareScope;

	function compareVersions(a, b) {
		const pa = String(a)
			.split('.')
			.map(n => parseInt(n, 10));
		const pb = String(b)
			.split('.')
			.map(n => parseInt(n, 10));
		const len = Math.max(pa.length, pb.length);
		for (let i = 0; i < len; i++) {
			const da = Number.isFinite(pa[i]) ? pa[i] : 0;
			const db = Number.isFinite(pb[i]) ? pb[i] : 0;
			if (da !== db) {
				return da - db;
			}
		}
		return 0;
	}

	async function loadShared(moduleName) {
		const scope = shareScope;
		if (!scope || !scope[moduleName]) {
			return null;
		}

		const versions = Object.keys(scope[moduleName]);
		if (!versions.length) {
			return null;
		}
		versions.sort(compareVersions);
		const best = versions[versions.length - 1];
		const entry = scope[moduleName][best];
		if (!entry || typeof entry.get !== 'function') {
			return null;
		}

		const factory = await entry.get();
		const mod = typeof factory === 'function' ? factory() : null;
		return mod && mod.__esModule && mod.default ? mod.default : mod;
	}

	function formatBytes(bytes) {
		const n = Number(bytes) || 0;
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(ms) {
		const d = new Date(Number(ms) || 0);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleString();
	}

	function isDarkTheme() {
		try {
			const doc = globalThis.document;
			const root = doc && doc.documentElement;
			const attrTheme =
				(root && (root.getAttribute('data-theme') || root.getAttribute('data-mui-color-scheme'))) || '';
			if (attrTheme === 'dark') return true;
			if (attrTheme === 'light') return false;

			const body = doc && doc.body;
			if (body && body.classList) {
				if (body.classList.contains('mui-theme-dark') || body.classList.contains('iob-theme-dark')) {
					return true;
				}
				if (body.classList.contains('mui-theme-light') || body.classList.contains('iob-theme-light')) {
					return false;
				}
			}

			return !!(
				globalThis.matchMedia && globalThis.matchMedia('(prefers-color-scheme: dark)').matches
			);
		} catch {
			return false;
		}
	}

	function base64FromDataUrl(dataUrl) {
		const idx = String(dataUrl || '').indexOf(',');
		return idx >= 0 ? dataUrl.slice(idx + 1) : '';
	}

	function downloadBase64File(fileName, base64) {
		try {
			const binary = atob(base64 || '');
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: 'application/gzip' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName || 'backup.solectrusbackup.json.gz';
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (e) {
			console.error(`[${REMOTE_NAME}] download failed`, e);
		}
	}

	function createSolectrusBackupEditor(React, AdapterReact) {
		return function SolectrusBackupEditor(props) {
			const socket = (props && props.socket) || globalThis.socket || globalThis._socket || null;

			const t = text => {
				try {
					if (props && typeof props.t === 'function') {
						return props.t(text);
					}
				} catch {
					// ignore
				}
				const I18n = (AdapterReact && AdapterReact.I18n) || (globalThis.window && globalThis.window.I18n);
				try {
					if (I18n && typeof I18n.t === 'function') {
						return I18n.t(text);
					}
				} catch {
					// ignore
				}
				return text;
			};

			const getInstanceId = () => {
				const instanceId = props && typeof props.instanceId === 'string' ? props.instanceId : '';
				if (instanceId && instanceId.startsWith('system.adapter.')) {
					return instanceId.slice('system.adapter.'.length);
				}
				if (instanceId) {
					return instanceId;
				}
				const adapterName = (props && (props.adapterName || props.adapter)) || 'solectrus-influxdb';
				const inst = props && Number.isFinite(props.instance) ? props.instance : 0;
				return `${adapterName}.${inst}`;
			};

			// Compatibility wrapper: returns a Promise, supporting both promise-based (Admin v7+)
			// and callback-based (older Admin) socket.sendTo implementations.
			const sendToCompat = (command, message) => {
				if (!socket || typeof socket.sendTo !== 'function') {
					return Promise.reject(new Error('socket.sendTo is not available'));
				}
				return new Promise((resolve, reject) => {
					try {
						const maybePromise = socket.sendTo(getInstanceId(), command, message, result => {
							if (result && result.ok === false) {
								reject(new Error(result.error || 'Unknown error'));
							} else {
								resolve(result);
							}
						});
						if (maybePromise && typeof maybePromise.then === 'function') {
							maybePromise.then(result => {
								if (result && result.ok === false) {
									reject(new Error(result.error || 'Unknown error'));
								} else {
									resolve(result);
								}
							}, reject);
						}
					} catch (e) {
						reject(e);
					}
				});
			};

			const [backups, setBackups] = React.useState([]);
			const [busy, setBusy] = React.useState('');
			const [message, setMessage] = React.useState('');
			const [isError, setIsError] = React.useState(false);
			const fileInputRef = React.useRef(null);

			const refresh = () => {
				sendToCompat('bkpList', {})
					.then(res => setBackups((res && res.backups) || []))
					.catch(e => {
						setIsError(true);
						setMessage(String((e && e.message) || e));
					});
			};

			React.useEffect(() => {
				refresh();
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			const run = (busyKey, promise, okText) => {
				setBusy(busyKey);
				setIsError(false);
				setMessage('');
				return promise
					.then(res => {
						if (res && Array.isArray(res.backups)) {
							setBackups(res.backups);
						}
						setMessage(okText);
						return res;
					})
					.catch(e => {
						setIsError(true);
						setMessage(String((e && e.message) || e));
					})
					.finally(() => setBusy(''));
			};

			const handleCreate = () => {
				run('create', sendToCompat('bkpCreate', {}), t('Backup created.'));
			};

			const handleUploadClick = () => {
				if (fileInputRef.current) {
					fileInputRef.current.value = '';
					fileInputRef.current.click();
				}
			};

			const handleFileSelected = e => {
				const file = e.target.files && e.target.files[0];
				if (!file) {
					return;
				}
				const reader = new FileReader();
				reader.onload = () => {
					const base64 = base64FromDataUrl(String(reader.result || ''));
					run(
						'upload',
						sendToCompat('bkpUpload', { fileName: file.name, base64 }),
						t('Backup uploaded.'),
					);
				};
				reader.onerror = () => {
					setIsError(true);
					setMessage(t('Could not read the selected file.'));
				};
				reader.readAsDataURL(file);
			};

			const handleRestore = fileName => {
				if (!globalThis.confirm(t('Restore this backup? The instance will restart.'))) {
					return;
				}
				run(`restore:${fileName}`, sendToCompat('bkpRestore', { fileName }), t('Backup restored.'));
			};

			const handleDelete = fileName => {
				if (!globalThis.confirm(t('Delete this backup?'))) {
					return;
				}
				run(`delete:${fileName}`, sendToCompat('bkpDelete', { fileName }), t('Backup deleted.'));
			};

			const handleDownload = fileName => {
				setBusy(`download:${fileName}`);
				sendToCompat('bkpDownload', { fileName })
					.then(res => downloadBase64File(fileName, res && res.base64))
					.catch(e => {
						setIsError(true);
						setMessage(String((e && e.message) || e));
					})
					.finally(() => setBusy(''));
			};

			const isDark = isDarkTheme();
			const textColor = isDark ? '#f0f0f0' : '#111111';

			const buttonStyle = {
				padding: '6px 14px',
				marginRight: 8,
				marginBottom: 8,
				border: '1px solid rgba(128,128,128,0.4)',
				borderRadius: 4,
				background: 'transparent',
				color: textColor,
				cursor: 'pointer',
			};

			const smallButtonStyle = Object.assign({}, buttonStyle, {
				padding: '3px 10px',
				marginRight: 6,
				marginBottom: 0,
				fontSize: '0.85em',
			});

			const thStyle = {
				textAlign: 'left',
				padding: '4px 8px',
				borderBottom: '1px solid rgba(128,128,128,0.4)',
				color: textColor,
			};
			const tdStyle = { padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.15)', color: textColor };

			return React.createElement(
				'div',
				{ style: { padding: 8, color: textColor } },
				React.createElement(
					'div',
					{ style: { marginBottom: 8 } },
					React.createElement(
						'button',
						{ type: 'button', style: buttonStyle, disabled: busy === 'create', onClick: handleCreate },
						busy === 'create' ? t('Creating…') : t('Create backup now'),
					),
					React.createElement(
						'button',
						{ type: 'button', style: buttonStyle, disabled: busy === 'upload', onClick: handleUploadClick },
						busy === 'upload' ? t('Uploading…') : t('Upload backup file'),
					),
					React.createElement('input', {
						ref: fileInputRef,
						type: 'file',
						accept: '.gz,application/gzip',
						style: { display: 'none' },
						onChange: handleFileSelected,
					}),
					React.createElement(
						'button',
						{ type: 'button', style: buttonStyle, onClick: refresh },
						t('Refresh'),
					),
				),
				message
					? React.createElement(
							'div',
							{ style: { marginBottom: 8, color: isError ? '#e74c3c' : '#27ae60' } },
							message,
						)
					: null,
				backups.length === 0
					? React.createElement('div', { style: { opacity: 0.75 } }, t('No backups yet.'))
					: React.createElement(
							'table',
							{ style: { borderCollapse: 'collapse', width: '100%' } },
							React.createElement(
								'thead',
								null,
								React.createElement(
									'tr',
									null,
									React.createElement('th', { style: thStyle }, t('Created')),
									React.createElement('th', { style: thStyle }, t('Size')),
									React.createElement('th', { style: thStyle }, t('Actions')),
								),
							),
							React.createElement(
								'tbody',
								null,
								backups.map(b =>
									React.createElement(
										'tr',
										{ key: b.fileName },
										React.createElement('td', { style: tdStyle }, formatDate(b.mtime)),
										React.createElement('td', { style: tdStyle }, formatBytes(b.size)),
										React.createElement(
											'td',
											{ style: tdStyle },
											React.createElement(
												'button',
												{
													type: 'button',
													style: smallButtonStyle,
													disabled: !!busy,
													onClick: () => handleRestore(b.fileName),
												},
												busy === `restore:${b.fileName}` ? t('Restoring…') : t('Restore'),
											),
											React.createElement(
												'button',
												{
													type: 'button',
													style: smallButtonStyle,
													disabled: !!busy,
													onClick: () => handleDownload(b.fileName),
												},
												busy === `download:${b.fileName}` ? t('Downloading…') : t('Download'),
											),
											React.createElement(
												'button',
												{
													type: 'button',
													style: smallButtonStyle,
													disabled: !!busy,
													onClick: () => handleDelete(b.fileName),
												},
												busy === `delete:${b.fileName}` ? t('Deleting…') : t('Delete'),
											),
										),
									),
								),
							),
						),
				React.createElement(
					'div',
					{ style: { marginTop: 8, fontSize: '0.75em', opacity: 0.5 } },
					`UI ${UI_VERSION}`,
				),
			);
		};
	}

	const moduleMap = {
		'./Components': async function () {
			const React = globalThis.React || (await loadShared('react'));
			const AdapterReact = await loadShared('@iobroker/adapter-react-v5');
			if (!React) {
				throw new Error('SolectrusBackup custom UI: React not available.');
			}
			const SolectrusBackupEditor = createSolectrusBackupEditor(React, AdapterReact);

			try {
				globalThis.customComponents = globalThis.customComponents || {};
				globalThis.customComponents.SolectrusBackupEditor = SolectrusBackupEditor;
			} catch {
				// ignore
			}

			return {
				default: {
					SolectrusBackupEditor,
				},
			};
		},
		Components: async function () {
			return moduleMap['./Components']();
		},
	};

	function get(module) {
		const factoryFn = moduleMap[module];
		if (!factoryFn) {
			return Promise.reject(new Error(`Module ${module} not found in ${REMOTE_NAME}`));
		}
		return Promise.resolve()
			.then(() => factoryFn())
			.then(mod => () => mod);
	}

	function init(scope) {
		shareScope = scope;
	}

	globalThis[REMOTE_NAME] = {
		get,
		init,
	};
})();
