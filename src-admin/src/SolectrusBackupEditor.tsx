import React from 'react';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n } from '@iobroker/gui-components';

// Lets the user create/upload/restore/download/delete local backups of this adapter instance
// (instance config, sensors, Data-SOLECTRUS items and the object tree) without needing the
// separate ioBroker.backitup adapter installed. Optionally the backups are also stored on a
// WebDAV server (like the WebDAV storage of ioBroker.backitup).
const UI_VERSION = '2026-10-19 20261019-1';

interface Backup {
    fileName: string;
    mtime: number;
    size: number;
}

interface BackupResult {
    ok?: boolean;
    error?: string;
    backups?: Backup[];
    base64?: string;
    webdavError?: string;
}

interface SolectrusBackupEditorState extends ConfigGenericState {
    backups: Backup[];
    webdavBackups: Backup[];
    busy: string;
    message: string;
    isError: boolean;
}

function formatBytes(bytes: number): string {
    const n = Number(bytes) || 0;
    if (n < 1024) {
        return `${n} B`;
    }
    if (n < 1024 * 1024) {
        return `${(n / 1024).toFixed(1)} KB`;
    }
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
    const d = new Date(Number(ms) || 0);
    if (isNaN(d.getTime())) {
        return '';
    }
    return d.toLocaleString();
}

function base64FromDataUrl(dataUrl: string): string {
    const idx = String(dataUrl || '').indexOf(',');
    return idx >= 0 ? dataUrl.slice(idx + 1) : '';
}

function downloadBase64File(fileName: string, base64?: string): void {
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
        console.error('[SolectrusBackup] download failed', e);
    }
}

const buttonStyle: React.CSSProperties = {
    padding: '6px 14px',
    marginRight: 8,
    marginBottom: 8,
    border: '1px solid rgba(128,128,128,0.4)',
    borderRadius: 4,
    background: 'transparent',
    // Browsers give <button> its own default (opaque, theme-independent) text color, so it
    // does not automatically pick up Admin's light/dark text color like a <div> or <td> does.
    // "inherit" forces it to use the ambient color instead of guessing a theme.
    color: 'inherit',
    cursor: 'pointer',
};

const smallButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    padding: '3px 10px',
    marginRight: 6,
    marginBottom: 0,
    fontSize: '0.85em',
};

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.4)' };
const tdStyle: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.15)' };

export default class SolectrusBackupEditor extends ConfigGeneric<ConfigGenericProps, SolectrusBackupEditorState> {
    private fileInputRef = React.createRef<HTMLInputElement>();

    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            backups: [],
            webdavBackups: [],
            busy: '',
            message: '',
            isError: false,
        };
    }

    async componentDidMount(): Promise<void> {
        await super.componentDidMount();
        this.refresh();
    }

    private getInstanceId(): string {
        return `${this.props.oContext.adapterName}.${this.props.oContext.instance}`;
    }

    // The Admin dialog only writes field edits to the running instance's config once the user
    // hits Save (which then restarts the instance) - the backend's own adapter.config.backupDir
    // can therefore lag behind what this still-open dialog currently shows. Sending the current
    // (possibly unsaved) value along on every request means Backup tab actions always act on
    // what's visible here, not a stale saved path - e.g. after fixing a directory that just
    // showed "access denied".
    private sendToCompat(command: string, message: Record<string, unknown>): Promise<BackupResult> {
        const backupDir = ConfigGeneric.getValue(this.props.data, 'backupDir');
        const data = this.props.data;
        const webdav = {
            enabled: ConfigGeneric.getValue(data, 'webdavEnabled'),
            url: ConfigGeneric.getValue(data, 'webdavURL'),
            username: ConfigGeneric.getValue(data, 'webdavUsername'),
            password: ConfigGeneric.getValue(data, 'webdavPassword'),
            dir: ConfigGeneric.getValue(data, 'webdavDir'),
            signedCertificates: ConfigGeneric.getValue(data, 'webdavSignedCertificates'),
            deleteOldBackup: ConfigGeneric.getValue(data, 'webdavDeleteOldBackup'),
        };
        return this.props.oContext.socket.sendTo(this.getInstanceId(), command, { backupDir, webdav, ...message });
    }

    private isWebdavEnabled(): boolean {
        return !!ConfigGeneric.getValue(this.props.data, 'webdavEnabled') && !!ConfigGeneric.getValue(this.props.data, 'webdavURL');
    }

    private refreshWebdav = (): void => {
        if (!this.isWebdavEnabled()) {
            this.setState({ webdavBackups: [] });
            return;
        }
        this.sendToCompat('bkpWebdavList', {})
            .then(res => {
                if (res && res.ok === false) {
                    this.setState({ isError: true, message: `WebDAV: ${res.error || ''}` });
                }
                this.setState({ webdavBackups: res?.backups || [] });
            })
            .catch((e: unknown) => this.setState({ isError: true, message: `WebDAV: ${String((e as Error)?.message || e)}` }));
    };

    private refresh = (): void => {
        // Clear any stale error from a previous attempt up front, so a successful refresh
        // (e.g. after fixing a bad backup directory) doesn't leave the old error message on
        // screen - it would otherwise only disappear on remount.
        this.setState({ isError: false, message: '' });
        this.sendToCompat('bkpList', {})
            .then(res => this.setState({ backups: res?.backups || [] }))
            .catch((e: unknown) => this.setState({ isError: true, message: String((e as Error)?.message || e) }));
        this.refreshWebdav();
    };

    private run(busyKey: string, promise: Promise<BackupResult>, okText: string): Promise<void> {
        this.setState({ busy: busyKey, isError: false, message: '' });
        return promise
            .then(res => {
                if (res && res.ok === false) {
                    throw new Error(res.error || '');
                }
                if (res && Array.isArray(res.backups)) {
                    this.setState({ backups: res.backups });
                }
                this.setState({ message: okText });
            })
            .catch((e: unknown) => this.setState({ isError: true, message: String((e as Error)?.message || e) }))
            .finally(() => this.setState({ busy: '' }));
    }

    private handleCreate = (): void => {
        this.setState({ busy: 'create', isError: false, message: '' });
        this.sendToCompat('bkpCreate', {})
            .then(res => {
                if (res && res.ok === false) {
                    throw new Error(res.error || '');
                }
                if (res && Array.isArray(res.backups)) {
                    this.setState({ backups: res.backups });
                }
                if (res?.webdavError) {
                    this.setState({
                        isError: true,
                        message: `${I18n.t('Backup created, but the WebDAV upload failed:')} ${res.webdavError}`,
                    });
                } else {
                    this.setState({
                        message: this.isWebdavEnabled()
                            ? I18n.t('Backup created and uploaded to WebDAV.')
                            : I18n.t('Backup created.'),
                    });
                }
                this.refreshWebdav();
            })
            .catch((e: unknown) => this.setState({ isError: true, message: String((e as Error)?.message || e) }))
            .finally(() => this.setState({ busy: '' }));
    };

    private handleWebdavRestore = (fileName: string): void => {
        if (
            !globalThis.confirm(
                I18n.t(
                    'Restore this backup? The instance will restart and this configuration dialog must be closed and reopened afterwards.',
                ),
            )
        ) {
            return;
        }
        void this.run(
            `webdavRestore:${fileName}`,
            this.sendToCompat('bkpWebdavRestore', { fileName }),
            I18n.t('Backup restored. Close and reopen this configuration dialog to see the updated settings.'),
        );
    };

    private handleWebdavDelete = (fileName: string): void => {
        if (!globalThis.confirm(I18n.t('Delete this backup?'))) {
            return;
        }
        this.setState({ busy: `webdavDelete:${fileName}`, isError: false, message: '' });
        this.sendToCompat('bkpWebdavDelete', { fileName })
            .then(res => {
                if (res && res.ok === false) {
                    throw new Error(res.error || '');
                }
                this.setState({ webdavBackups: res?.backups || [], message: I18n.t('Backup deleted.') });
            })
            .catch((e: unknown) => this.setState({ isError: true, message: String((e as Error)?.message || e) }))
            .finally(() => this.setState({ busy: '' }));
    };

    private handleUploadClick = (): void => {
        if (this.fileInputRef.current) {
            this.fileInputRef.current.value = '';
            this.fileInputRef.current.click();
        }
    };

    private handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = base64FromDataUrl(String(reader.result || ''));
            void this.run(
                'upload',
                this.sendToCompat('bkpUpload', { fileName: file.name, base64 }),
                I18n.t('Backup uploaded.'),
            );
        };
        reader.onerror = () => {
            this.setState({ isError: true, message: I18n.t('Could not read the selected file.') });
        };
        reader.readAsDataURL(file);
    };

    private handleRestore = (fileName: string): void => {
        if (
            !globalThis.confirm(
                I18n.t(
                    'Restore this backup? The instance will restart and this configuration dialog must be closed and reopened afterwards.',
                ),
            )
        ) {
            return;
        }
        void this.run(
            `restore:${fileName}`,
            this.sendToCompat('bkpRestore', { fileName }),
            I18n.t('Backup restored. Close and reopen this configuration dialog to see the updated settings.'),
        );
    };

    private handleDelete = (fileName: string): void => {
        if (!globalThis.confirm(I18n.t('Delete this backup?'))) {
            return;
        }
        void this.run(`delete:${fileName}`, this.sendToCompat('bkpDelete', { fileName }), I18n.t('Backup deleted.'));
    };

    private handleDownload = (fileName: string): void => {
        this.setState({ busy: `download:${fileName}` });
        this.sendToCompat('bkpDownload', { fileName })
            .then(res => downloadBase64File(fileName, res?.base64))
            .catch((e: unknown) => this.setState({ isError: true, message: String((e as Error)?.message || e) }))
            .finally(() => this.setState({ busy: '' }));
    };

    renderItem(): React.JSX.Element {
        const { backups, webdavBackups, busy, message, isError } = this.state;

        return (
            <div style={{ padding: 8 }}>
                <div style={{ marginBottom: 8 }}>
                    <button type="button" style={buttonStyle} disabled={busy === 'create'} onClick={this.handleCreate}>
                        {busy === 'create' ? I18n.t('Creating…') : I18n.t('Create backup now')}
                    </button>
                    <button type="button" style={buttonStyle} disabled={busy === 'upload'} onClick={this.handleUploadClick}>
                        {busy === 'upload' ? I18n.t('Uploading…') : I18n.t('Upload backup file')}
                    </button>
                    <input
                        ref={this.fileInputRef}
                        type="file"
                        accept=".gz,application/gzip"
                        style={{ display: 'none' }}
                        onChange={this.handleFileSelected}
                    />
                    <button type="button" style={buttonStyle} onClick={this.refresh}>
                        {I18n.t('Refresh')}
                    </button>
                </div>
                {message ? (
                    <div style={{ marginBottom: 8, color: isError ? '#e74c3c' : '#27ae60' }}>{message}</div>
                ) : null}
                {backups.length === 0 ? (
                    <div style={{ opacity: 0.75 }}>{I18n.t('No backups yet.')}</div>
                ) : (
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                            <tr>
                                <th style={thStyle}>{I18n.t('Created')}</th>
                                <th style={thStyle}>{I18n.t('Size')}</th>
                                <th style={thStyle}>{I18n.t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {backups.map(b => (
                                <tr key={b.fileName}>
                                    <td style={tdStyle}>{formatDate(b.mtime)}</td>
                                    <td style={tdStyle}>{formatBytes(b.size)}</td>
                                    <td style={tdStyle}>
                                        <button
                                            type="button"
                                            style={smallButtonStyle}
                                            disabled={!!busy}
                                            onClick={() => this.handleRestore(b.fileName)}
                                        >
                                            {busy === `restore:${b.fileName}` ? I18n.t('Restoring…') : I18n.t('Restore')}
                                        </button>
                                        <button
                                            type="button"
                                            style={smallButtonStyle}
                                            disabled={!!busy}
                                            onClick={() => this.handleDownload(b.fileName)}
                                        >
                                            {busy === `download:${b.fileName}` ? I18n.t('Downloading…') : I18n.t('Download')}
                                        </button>
                                        <button
                                            type="button"
                                            style={smallButtonStyle}
                                            disabled={!!busy}
                                            onClick={() => this.handleDelete(b.fileName)}
                                        >
                                            {busy === `delete:${b.fileName}` ? I18n.t('Deleting…') : I18n.t('Delete')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {this.isWebdavEnabled() ? (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{I18n.t('WebDAV backups')}</div>
                        {webdavBackups.length === 0 ? (
                            <div style={{ opacity: 0.75 }}>{I18n.t('No WebDAV backups found.')}</div>
                        ) : (
                            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <thead>
                                    <tr>
                                        <th style={thStyle}>{I18n.t('Created')}</th>
                                        <th style={thStyle}>{I18n.t('Size')}</th>
                                        <th style={thStyle}>{I18n.t('Actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {webdavBackups.map(b => (
                                        <tr key={b.fileName}>
                                            <td style={tdStyle}>{formatDate(b.mtime)}</td>
                                            <td style={tdStyle}>{formatBytes(b.size)}</td>
                                            <td style={tdStyle}>
                                                <button
                                                    type="button"
                                                    style={smallButtonStyle}
                                                    disabled={!!busy}
                                                    onClick={() => this.handleWebdavRestore(b.fileName)}
                                                >
                                                    {busy === `webdavRestore:${b.fileName}`
                                                        ? I18n.t('Restoring…')
                                                        : I18n.t('Restore')}
                                                </button>
                                                <button
                                                    type="button"
                                                    style={smallButtonStyle}
                                                    disabled={!!busy}
                                                    onClick={() => this.handleWebdavDelete(b.fileName)}
                                                >
                                                    {busy === `webdavDelete:${b.fileName}`
                                                        ? I18n.t('Deleting…')
                                                        : I18n.t('Delete')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                ) : null}
                <div style={{ marginTop: 8, fontSize: '0.75em', opacity: 0.5 }}>UI {UI_VERSION}</div>
            </div>
        );
    }
}
