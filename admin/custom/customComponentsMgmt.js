/* eslint-disable */
// @ts-nocheck

// Management tab custom component for ioBroker Admin jsonConfig.
// Provides "Apply Configuration" and "Delete States" actions via sendTo,
// so the adapter does not need to be restarted after configuration changes.
// Exposes: SolectrusMgmt/Components -> default export object containing { SolectrusMgmtEditor }.
(function () {
	'use strict';

	const REMOTE_NAME = 'SolectrusMgmt';
	const UI_VERSION = '2026-03-15 v1.0.0';
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
			if (da !== db) return da - db;
		}
		return 0;
	}

	async function loadShared(moduleName) {
		const scope = shareScope;
		if (!scope || !scope[moduleName]) return null;
		const versions = Object.keys(scope[moduleName]);
		if (!versions.length) return null;
		versions.sort(compareVersions);
		const best = versions[versions.length - 1];
		const entry = scope[moduleName][best];
		if (!entry || typeof entry.get !== 'function') return null;
		const factory = await entry.get();
		const mod = typeof factory === 'function' ? factory() : null;
		return mod && mod.__esModule && mod.default ? mod.default : mod;
	}

	function createSolectrusMgmtEditor(React) {
		return function SolectrusMgmtEditor(props) {
			const socket = (props && props.socket) || globalThis.socket || globalThis._socket || null;

			const getThemeType = () => {
				if (props && typeof props.themeType === 'string' && props.themeType) {
					return props.themeType;
				}
				const mode = props && props.theme && props.theme.palette && props.theme.palette.mode;
				if (mode === 'dark' || mode === 'light') return mode;
				try {
					const doc = globalThis.document;
					const htmlTheme = doc && doc.documentElement ? doc.documentElement.getAttribute('data-theme') : '';
					if (htmlTheme === 'dark' || htmlTheme === 'light') return htmlTheme;
				} catch {
					// ignore
				}
				return '';
			};

			const themeType = getThemeType();
			const isDark = themeType === 'dark';

			const colors = {
				panelBg: isDark ? '#1e2229' : '#f9fafb',
				text: isDark ? '#e2e8f0' : '#1a202c',
				textMuted: isDark ? '#94a3b8' : '#718096',
				border: isDark ? '#374151' : '#e2e8f0',
				btnBg: isDark ? '#374151' : '#e2e8f0',
				btnHover: isDark ? '#4b5563' : '#d1d5db',
				successBg: isDark ? 'rgba(46,204,113,0.12)' : 'rgba(46,204,113,0.10)',
				successBorder: isDark ? 'rgba(46,204,113,0.35)' : 'rgba(46,204,113,0.25)',
				successText: isDark ? '#86efac' : '#166534',
				errorBg: isDark ? 'rgba(231,76,60,0.12)' : 'rgba(231,76,60,0.10)',
				errorBorder: isDark ? 'rgba(231,76,60,0.35)' : 'rgba(231,76,60,0.25)',
				errorText: isDark ? '#fca5a5' : '#991b1b',
				warningBg: isDark ? 'rgba(234,179,8,0.12)' : 'rgba(234,179,8,0.10)',
				warningBorder: isDark ? 'rgba(234,179,8,0.35)' : 'rgba(234,179,8,0.25)',
				warningText: isDark ? '#fde047' : '#854d0e',
				divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
			};

			const t = text => {
				try {
					if (props && typeof props.t === 'function') return props.t(text);
				} catch {
					// ignore
				}
				return text;
			};

			const getAdapterInstanceId = () => {
				const adapterName = (props && (props.adapterName || props.adapter)) || 'solectrus-influxdb';
				const instanceId = props && typeof props.instanceId === 'string' ? props.instanceId : '';
				if (instanceId && String(instanceId).startsWith('system.adapter.')) return String(instanceId);
				if (instanceId && /^[a-zA-Z0-9_-]+\.\d+$/.test(String(instanceId))) return String(instanceId);
				const inst = props && Number.isFinite(props.instance) ? props.instance : 0;
				return `${adapterName}.${inst}`;
			};

			const getAdapterAliveId = () => {
				const base = getAdapterInstanceId();
				if (!base) return '';
				return String(base).startsWith('system.adapter.')
					? `${base}.alive`
					: `system.adapter.${base}.alive`;
			};

			const [initStatus, setInitStatus] = React.useState(null); // null | { ok, msg, loading }
			const [deleteStatus, setDeleteStatus] = React.useState(null);
			const [adapterAlive, setAdapterAlive] = React.useState(null); // null = unknown, true/false
			const [confirmDelete, setConfirmDelete] = React.useState(false);

			// Check adapter alive on mount and periodically
			React.useEffect(() => {
				let alive = true;
				const check = async () => {
					if (!alive) return;
					if (!socket || typeof socket.getState !== 'function') {
						setAdapterAlive(null);
						return;
					}
					try {
						const aliveId = getAdapterAliveId();
						if (!aliveId) {
							setAdapterAlive(null);
							return;
						}
						const st = await socket.getState(aliveId);
						if (!alive) return;
						setAdapterAlive(!!(st && st.val));
					} catch {
						if (alive) setAdapterAlive(null);
					}
				};
				check();
				let timer = null;
				try {
					timer = setInterval(check, 5000);
				} catch {
					// ignore
				}
				return () => {
					alive = false;
					if (timer) {
						try {
							clearInterval(timer);
						} catch {
							// ignore
						}
					}
				};
			}, []);

			const sendCommand = async (command, setStatus) => {
				if (!socket || typeof socket.sendTo !== 'function') {
					setStatus({ ok: false, msg: t('mgmt.noSocket'), loading: false });
					return;
				}
				const target = getAdapterInstanceId();
				if (!target) {
					setStatus({ ok: false, msg: t('mgmt.noTarget'), loading: false });
					return;
				}
				setStatus({ ok: null, msg: t('mgmt.running'), loading: true });
				try {
					const result = await new Promise((resolve, reject) => {
						try {
							socket.sendTo(target, command, {}, (res) => {
								if (res && res.error) {
									reject(new Error(res.error));
								} else {
									resolve(res || {});
								}
							});
						} catch (e) {
							reject(e);
						}
					});
					const msg =
						command === 'deleteStates'
							? t('mgmt.deleteSuccess').replace('%n', String(result.deleted || 0))
							: t('mgmt.initSuccess');
					setStatus({ ok: true, msg, loading: false });
				} catch (e) {
					setStatus({ ok: false, msg: String((e && e.message) || e), loading: false });
				}
			};

			const handleInit = () => {
				setDeleteStatus(null);
				sendCommand('initStates', setInitStatus);
			};

			const handleDeleteConfirm = () => {
				setConfirmDelete(false);
				setInitStatus(null);
				sendCommand('deleteStates', setDeleteStatus);
			};

			// Styles
			const containerStyle = {
				fontFamily: 'inherit',
				color: colors.text,
				padding: '12px 0',
				maxWidth: 600,
			};

			const sectionStyle = {
				marginBottom: 24,
				padding: 16,
				borderRadius: 10,
				border: `1px solid ${colors.border}`,
				background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
			};

			const sectionTitleStyle = {
				fontSize: 14,
				fontWeight: 700,
				color: colors.text,
				marginBottom: 6,
			};

			const sectionDescStyle = {
				fontSize: 12,
				color: colors.textMuted,
				marginBottom: 12,
				lineHeight: 1.5,
			};

			const btnBase = {
				display: 'inline-flex',
				alignItems: 'center',
				gap: 6,
				padding: '8px 16px',
				borderRadius: 8,
				border: `1px solid ${colors.border}`,
				background: colors.btnBg,
				color: colors.text,
				cursor: 'pointer',
				fontFamily: 'inherit',
				fontSize: 13,
				fontWeight: 500,
				transition: 'background 0.15s',
			};

			const btnPrimary = Object.assign({}, btnBase, {
				background: isDark ? '#2563eb' : '#3b82f6',
				border: 'none',
				color: '#ffffff',
			});

			const btnDanger = Object.assign({}, btnBase, {
				background: isDark ? '#dc2626' : '#ef4444',
				border: 'none',
				color: '#ffffff',
			});

			const btnDisabled = Object.assign({}, btnBase, {
				opacity: 0.45,
				cursor: 'not-allowed',
			});

			const statusPillStyle = ok => ({
				marginTop: 10,
				padding: '8px 12px',
				borderRadius: 8,
				fontSize: 12,
				border: `1px solid ${ok === true ? colors.successBorder : ok === false ? colors.errorBorder : colors.warningBorder}`,
				background: ok === true ? colors.successBg : ok === false ? colors.errorBg : colors.warningBg,
				color: ok === true ? colors.successText : ok === false ? colors.errorText : colors.warningText,
			});

			const dividerStyle = {
				height: 1,
				background: colors.divider,
				margin: '16px 0',
			};

			const aliveIndicator = () => {
				if (adapterAlive === null) {
					return React.createElement(
						'span',
						{ style: { fontSize: 12, color: colors.textMuted } },
						`⚪ ${t('mgmt.statusUnknown')}`,
					);
				}
				if (adapterAlive) {
					return React.createElement(
						'span',
						{ style: { fontSize: 12, color: colors.successText } },
						`🟢 ${t('mgmt.adapterRunning')}`,
					);
				}
				return React.createElement(
					'span',
					{ style: { fontSize: 12, color: colors.errorText } },
					`🔴 ${t('mgmt.adapterStopped')}`,
				);
			};

			const renderStatus = status => {
				if (!status) return null;
				if (status.loading) {
					return React.createElement(
						'div',
						{ style: statusPillStyle(null) },
						`⏳ ${status.msg}`,
					);
				}
				return React.createElement(
					'div',
					{ style: statusPillStyle(status.ok) },
					status.ok ? `✅ ${status.msg}` : `❌ ${status.msg}`,
				);
			};

			const isSocketAvailable = !!(socket && typeof socket.sendTo === 'function');

			// Confirm delete overlay
			const renderConfirmDelete = () => {
				if (!confirmDelete) return null;
				const overlayStyle = {
					position: 'fixed',
					inset: 0,
					background: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
					zIndex: 9000,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					padding: 16,
				};
				const dialogStyle = {
					background: isDark ? '#1e2229' : '#ffffff',
					border: `1px solid ${colors.border}`,
					borderRadius: 12,
					padding: 24,
					maxWidth: 420,
					width: '100%',
					boxShadow: isDark ? '0 12px 40px rgba(0,0,0,0.6)' : '0 12px 40px rgba(0,0,0,0.2)',
				};
				return React.createElement(
					'div',
					{ style: overlayStyle, onMouseDown: e => { if (e.target === e.currentTarget) setConfirmDelete(false); } },
					React.createElement(
						'div',
						{ style: dialogStyle },
						React.createElement(
							'div',
							{ style: { fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 8 } },
							t('mgmt.deleteConfirmTitle'),
						),
						React.createElement(
							'div',
							{ style: { fontSize: 13, color: colors.textMuted, marginBottom: 20, lineHeight: 1.6 } },
							t('mgmt.deleteConfirmText'),
						),
						React.createElement(
							'div',
							{ style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
							React.createElement(
								'button',
								{ type: 'button', style: btnBase, onClick: () => setConfirmDelete(false) },
								t('Cancel'),
							),
							React.createElement(
								'button',
								{ type: 'button', style: btnDanger, onClick: handleDeleteConfirm },
								t('mgmt.deleteConfirm'),
							),
						),
					),
				);
			};

			return React.createElement(
				'div',
				{ style: containerStyle },

				// Status bar
				React.createElement(
					'div',
					{ style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 } },
					aliveIndicator(),
				),

				// Apply Configuration section
				React.createElement(
					'div',
					{ style: sectionStyle },
					React.createElement('div', { style: sectionTitleStyle }, t('mgmt.initTitle')),
					React.createElement('div', { style: sectionDescStyle }, t('mgmt.initDesc')),
					React.createElement(
						'button',
						{
							type: 'button',
							style: isSocketAvailable && !initStatus?.loading ? btnPrimary : btnDisabled,
							disabled: !isSocketAvailable || !!(initStatus && initStatus.loading),
							onClick: handleInit,
						},
						t('mgmt.initBtn'),
					),
					renderStatus(initStatus),
				),

				React.createElement('div', { style: dividerStyle }),

				// Delete States section
				React.createElement(
					'div',
					{ style: sectionStyle },
					React.createElement('div', { style: sectionTitleStyle }, t('mgmt.deleteTitle')),
					React.createElement('div', { style: sectionDescStyle }, t('mgmt.deleteDesc')),
					React.createElement(
						'button',
						{
							type: 'button',
							style: isSocketAvailable && !deleteStatus?.loading ? btnDanger : btnDisabled,
							disabled: !isSocketAvailable || !!(deleteStatus && deleteStatus.loading),
							onClick: () => setConfirmDelete(true),
						},
						t('mgmt.deleteBtn'),
					),
					renderStatus(deleteStatus),
				),

				renderConfirmDelete(),
			);
		};
	}

	const moduleMap = {
		'./Components': async function () {
			const React = globalThis.React || (await loadShared('react'));
			if (!React) {
				throw new Error('SolectrusMgmt custom UI: React not available.');
			}
			const SolectrusMgmtEditor = createSolectrusMgmtEditor(React);

			// Legacy global registry (best-effort)
			try {
				globalThis.customComponents = globalThis.customComponents || {};
				globalThis.customComponents.SolectrusMgmtEditor = SolectrusMgmtEditor;
			} catch {
				// ignore
			}

			return {
				default: {
					SolectrusMgmtEditor,
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
