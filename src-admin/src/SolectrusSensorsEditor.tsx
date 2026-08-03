import React from 'react';
import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from '@iobroker/json-config';
import { I18n, DialogSelectID } from '@iobroker/gui-components';

const DEFAULT_SENSOR_GROUP_KEY = 'Default SOLECTRUS sensors';
const CUSTOM_SENSOR_GROUP_KEY = 'Custom sensors';

export interface Sensor {
    enabled?: boolean;
    internal?: boolean;
    group?: string;
    SensorName?: string;
    sourceState?: string;
    type?: string;
    measurement?: string;
    field?: string;
    unit?: string;
    maxValue?: number;
    aliveTimeoutMinutes?: number | null;
    jsonPreset?: string;
    jsonTsField?: string;
    jsonValField?: string;
    jsonInfluxType?: string;
    _title?: string;
    [key: string]: unknown;
}

function isDefaultSensorName(name: unknown): boolean {
    const sensorName = String(name || '').trim();
    return [
        /^INVERTER_POWER(?:_[1-5])?$/,
        /^GRID_(?:IMPORT_POWER|EXPORT_POWER|EXPORT_LIMIT)$/,
        /^CASE_TEMP$/,
        /^SYSTEM_STATUS(?:_OK)?$/,
        /^BATTERY_(?:SOC|CHARGING_POWER|DISCHARGING_POWER)$/,
        /^HOUSE_POWER$/,
        /^HEATPUMP_(?:POWER|HEATING_POWER|TANK_TEMP|TANK_TEMP_SETPOINT|STATUS)$/,
        /^CUSTOM_POWER_\d{2}$/,
        /^WALLBOX_(?:POWER|CONNECTED)$/,
        /^CAR_BATTERY_SOC$/,
        /^OUTDOOR_TEMP(?:_FORECAST)?$/,
        /^INVERTER_POWER_FORECAST(?:_CLEARSKY)?$/,
    ].some(pattern => pattern.test(sensorName));
}

function hasExplicitSensorGroup(sensor: Sensor | null | undefined): boolean {
    return !!(
        sensor &&
        typeof sensor === 'object' &&
        Object.prototype.hasOwnProperty.call(sensor, 'group') &&
        sensor.group !== undefined &&
        (sensor.group as unknown) !== null
    );
}

function hasConfiguredSensor(sensor: Sensor | null | undefined): boolean {
    return !!String(sensor?.SensorName || '').trim();
}

function canonicalizeSensorGroupName(value: unknown, t: (s: string) => string = I18n.t): string {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return '';
    }
    if (trimmed === DEFAULT_SENSOR_GROUP_KEY || trimmed === 'Standard Solectrus Sensoren' || trimmed === 'Standard SOLECTRUS Sensoren') {
        return DEFAULT_SENSOR_GROUP_KEY;
    }
    if (trimmed === t(DEFAULT_SENSOR_GROUP_KEY)) {
        return DEFAULT_SENSOR_GROUP_KEY;
    }
    if (trimmed === CUSTOM_SENSOR_GROUP_KEY || trimmed === 'Benutzerdefiniert') {
        return CUSTOM_SENSOR_GROUP_KEY;
    }
    if (trimmed === t(CUSTOM_SENSOR_GROUP_KEY)) {
        return CUSTOM_SENSOR_GROUP_KEY;
    }
    return trimmed;
}

function getSensorGroupKey(sensor: Sensor | null | undefined, t: (s: string) => string = I18n.t): string {
    if (hasExplicitSensorGroup(sensor)) {
        return canonicalizeSensorGroupName(sensor?.group, t);
    }
    if (isDefaultSensorName(sensor?.SensorName)) {
        return DEFAULT_SENSOR_GROUP_KEY;
    }
    return hasConfiguredSensor(sensor) ? CUSTOM_SENSOR_GROUP_KEY : '';
}

function displaySensorGroupName(value: unknown, t: (s: string) => string = I18n.t): string {
    const normalized = canonicalizeSensorGroupName(value, t);
    if (!normalized) {
        return t('Ungrouped');
    }
    if (normalized === DEFAULT_SENSOR_GROUP_KEY || normalized === CUSTOM_SENSOR_GROUP_KEY) {
        return t(normalized);
    }
    return normalized;
}

function sensorGroupInputValue(value: unknown, t: (s: string) => string = I18n.t): string {
    const rawValue = value === undefined || value === null ? '' : String(value);
    if (!rawValue) {
        return '';
    }
    // Keep leading/trailing whitespace while the user is typing so spaces can be entered naturally.
    // Canonicalization still runs on blur before persisting.
    if (rawValue !== rawValue.trim()) {
        return rawValue;
    }
    const normalized = canonicalizeSensorGroupName(rawValue, t);
    if (!normalized) {
        return '';
    }
    if (normalized === DEFAULT_SENSOR_GROUP_KEY || normalized === CUSTOM_SENSOR_GROUP_KEY) {
        return t(normalized);
    }
    return normalized;
}

function normalizeSensors(value: unknown): Sensor[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((v): v is Sensor => !!v && typeof v === 'object')
        .map(sensor => {
            const next: Sensor = { ...sensor };
            if (hasExplicitSensorGroup(next)) {
                const group = canonicalizeSensorGroupName(next.group);
                next.group = group || '';
            } else {
                const group = getSensorGroupKey(next);
                if (group) {
                    next.group = group;
                } else {
                    delete next.group;
                }
            }
            return next;
        });
}

function sensorStateIcon(sensor: Sensor | null | undefined): string {
    const enabled = !!sensor?.enabled;
    const internal = !!sensor?.internal;
    if (!enabled) {
        return '⚪';
    }
    return internal ? '🟡' : '🟢';
}

function calcTitle(sensor: Sensor | null | undefined): string {
    const sensorName = sensor?.SensorName || 'Sensor';
    return `${sensorStateIcon(sensor)} ${sensorName}`;
}

function ensureTitle(sensor: Sensor): Sensor {
    return { ...sensor, _title: calcTitle(sensor) };
}

const MONITORING_ACTIVE_COLOR = '#4caf50';
const MONITORING_DISABLED_COLOR = '#f44336';

const JSON_PRESETS: Record<string, { valField: string; valDesc: string; measurement: string; field: string }> = {
    forecast: { valField: 'y', valDesc: 'Forecast', measurement: 'inverter_forecast', field: 'power' },
    clearsky: { valField: 'clearsky', valDesc: 'Forecast Clearsky', measurement: 'inverter_forecast_clearsky', field: 'power' },
    temperature: { valField: 'temp', valDesc: 'Temperature', measurement: 'outdoor_forecast', field: 'temperature' },
};

function makeNewSensor(): Sensor {
    return ensureTitle({
        enabled: false,
        internal: false,
        group: CUSTOM_SENSOR_GROUP_KEY,
        SensorName: '',
        sourceState: '',
        type: '',
        measurement: 'solectrus',
        field: '',
        aliveTimeoutMinutes: 60,
    });
}

function cloneForDraft(item: Sensor | null): Sensor | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    try {
        return JSON.parse(JSON.stringify(item));
    } catch {
        return { ...item };
    }
}

// Module-scoped draft cache: survives component unmount/remount cycles that Admin may
// trigger on every onChange/forceUpdate call. Keyed by "attr_selectedIndex" so each
// sensor slot has its own draft.
const _draftCache: Record<string, Sensor | null> = {};

interface SolectrusSensorsEditorState extends ConfigGenericState {
    selectedIndex: number;
    showSelectStateId: boolean;
    collapsedFolders: Record<string, boolean>;
    selectedDraft: Sensor | null;
}

export default class SolectrusSensorsEditor extends ConfigGeneric<ConfigGenericProps, SolectrusSensorsEditorState> {
    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            selectedIndex: 0,
            showSelectStateId: false,
            collapsedFolders: {},
            selectedDraft: null,
        };
    }

    async componentDidMount(): Promise<void> {
        await super.componentDidMount();
        this.setState({ selectedDraft: _draftCache[this.draftCacheKey] || cloneForDraft(this.selectedSensor) });
    }

    componentDidUpdate(_prevProps: ConfigGenericProps, prevState: SolectrusSensorsEditorState): void {
        const sensors = this.sensors;
        if (this.state.selectedIndex > sensors.length - 1) {
            this.setState({ selectedIndex: Math.max(0, sensors.length - 1) });
            return;
        }
        if (prevState.selectedIndex !== this.state.selectedIndex) {
            const cached = _draftCache[this.draftCacheKey];
            const nextDraft = cached || cloneForDraft(this.selectedSensor);
            if (nextDraft !== this.state.selectedDraft) {
                this.setState({ selectedDraft: nextDraft });
            }
        }
    }

    private get attr(): string {
        return this.props.attr || 'sensors';
    }

    private get sensors(): Sensor[] {
        return normalizeSensors(ConfigGeneric.getValue(this.props.data, this.attr));
    }

    private get expertMode(): boolean {
        return !!ConfigGeneric.getValue(this.props.data, 'enableExpertMode');
    }

    private get draftCacheKey(): string {
        return `${this.attr}_${this.state.selectedIndex}`;
    }

    private get selectedSensor(): Sensor | null {
        return this.sensors[this.state.selectedIndex] || null;
    }

    private get groupedSensors(): { key: string; label: string; items: { sensor: Sensor; index: number }[] }[] {
        const groups: Record<string, { sensor: Sensor; index: number }[]> = {};
        this.sensors.forEach((sensor, index) => {
            const groupKey = getSensorGroupKey(sensor);
            groups[groupKey] = groups[groupKey] || [];
            groups[groupKey].push({ sensor, index });
        });
        return Object.keys(groups)
            .sort((a, b) => {
                if (a === DEFAULT_SENSOR_GROUP_KEY) {
                    return -1;
                }
                if (b === DEFAULT_SENSOR_GROUP_KEY) {
                    return 1;
                }
                if (!a) {
                    return 1;
                }
                if (!b) {
                    return -1;
                }
                return displaySensorGroupName(a).localeCompare(displaySensorGroupName(b), undefined, { sensitivity: 'base' });
            })
            .map(groupKey => ({ key: groupKey, label: displaySensorGroupName(groupKey), items: groups[groupKey] }));
    }

    private updateSensors = (nextSensors: Sensor[]): void => {
        void this.onChange(this.attr, nextSensors);
    };

    private ensureDraftBase = (prevDraft: Sensor | null): Sensor => {
        return (prevDraft && typeof prevDraft === 'object' ? prevDraft : cloneForDraft(this.selectedSensor)) || {};
    };

    private setDraftField = (field: string, value: unknown): void => {
        this.setState(state => {
            const base = this.ensureDraftBase(state.selectedDraft);
            const next = { ...base, [field]: value };
            _draftCache[this.draftCacheKey] = next;
            return { selectedDraft: next };
        });
    };

    private updateSelected = (field: string, value: unknown): void => {
        const titleAffectingFields = ['enabled', 'SensorName'];
        const shouldUpdateTitle = titleAffectingFields.includes(field);
        const selectedIndex = this.state.selectedIndex;
        const nextSensors = this.sensors.map((s, i) => {
            if (i !== selectedIndex) {
                return s;
            }
            const next = { ...s, [field]: value };
            return shouldUpdateTitle ? ensureTitle(next) : next;
        });
        this.updateSensors(nextSensors);
    };

    private updateSelectedMulti = (updates: Partial<Sensor>): void => {
        const titleAffectingFields = ['enabled', 'SensorName'];
        const shouldUpdateTitle = Object.keys(updates).some(k => titleAffectingFields.includes(k));
        const selectedIndex = this.state.selectedIndex;
        const nextSensors = this.sensors.map((s, i) => {
            if (i !== selectedIndex) {
                return s;
            }
            const next = { ...s, ...updates };
            return shouldUpdateTitle ? ensureTitle(next) : next;
        });
        this.updateSensors(nextSensors);
    };

    private autoDetectUnit = (stateId: string, capturedSensorIndex: number): void => {
        if (!stateId) {
            return;
        }
        this.props.oContext.socket
            .getObject(stateId)
            .then(obj => {
                const detectedUnit = obj?.common && (obj.common as { unit?: unknown }).unit != null ? String((obj.common as { unit?: unknown }).unit) : '';
                if (this.state.selectedIndex !== capturedSensorIndex) {
                    return;
                }
                this.setDraftField('unit', detectedUnit);
                const nextSensors = this.sensors.map((s, i) => (i !== capturedSensorIndex ? s : { ...s, unit: detectedUnit }));
                this.updateSensors(nextSensors);
            })
            .catch(() => {
                /* silently ignore */
            });
    };

    private toggleFolder = (folderKey: string): void => {
        const key = folderKey || '__ungrouped__';
        this.setState(state => ({ collapsedFolders: { ...state.collapsedFolders, [key]: !state.collapsedFolders[key] } }));
    };

    private moveSelected = (direction: number): void => {
        const sensors = this.sensors;
        const from = this.state.selectedIndex;
        const to = from + direction;
        if (to < 0 || to >= sensors.length) {
            return;
        }
        const nextSensors = sensors.slice();
        const tmp = nextSensors[from];
        nextSensors[from] = nextSensors[to];
        nextSensors[to] = tmp;

        // Swap draft cache entries so the moved sensor keeps its unsaved draft at the new
        // index and the displaced sensor keeps its draft at the old index.
        const keyFrom = `${this.attr}_${from}`;
        const keyTo = `${this.attr}_${to}`;
        const draftFrom = _draftCache[keyFrom];
        const draftTo = _draftCache[keyTo];
        if (draftTo !== undefined) {
            _draftCache[keyFrom] = draftTo;
        } else {
            delete _draftCache[keyFrom];
        }
        if (draftFrom !== undefined) {
            _draftCache[keyTo] = draftFrom;
        } else {
            delete _draftCache[keyTo];
        }

        this.setState({ selectedIndex: to, selectedDraft: _draftCache[keyTo] || cloneForDraft(nextSensors[to]) });
        this.updateSensors(nextSensors);
    };

    private addSensor = (): void => {
        const nextSensors = this.sensors.concat([makeNewSensor()]);
        this.updateSensors(nextSensors);
        this.setState({ selectedIndex: nextSensors.length - 1 });
    };

    private cloneSelected = (): void => {
        const selectedSensor = this.selectedSensor;
        if (!selectedSensor) {
            return;
        }
        const sensors = this.sensors;
        const selectedIndex = this.state.selectedIndex;
        const clone = ensureTitle({ ...selectedSensor });
        const nextSensors = sensors.slice();
        nextSensors.splice(selectedIndex + 1, 0, clone);

        // Shift draft cache entries up for all sensors displaced by the insertion so that
        // previously-edited sensors keep their unsaved drafts at the correct key. Then seed
        // the new slot with the clone's own data.
        for (let i = sensors.length - 1; i >= selectedIndex + 1; i--) {
            const src = `${this.attr}_${i}`;
            const dst = `${this.attr}_${i + 1}`;
            if (_draftCache[src] !== undefined) {
                _draftCache[dst] = _draftCache[src];
            } else {
                delete _draftCache[dst];
            }
            delete _draftCache[src];
        }
        const cloneDraft = cloneForDraft(clone);
        _draftCache[`${this.attr}_${selectedIndex + 1}`] = cloneDraft;

        this.setState({ selectedIndex: selectedIndex + 1, selectedDraft: cloneDraft });
        this.updateSensors(nextSensors);
    };

    private deleteSelected = (): void => {
        const selectedSensor = this.selectedSensor;
        if (!selectedSensor) {
            return;
        }
        const sensors = this.sensors;
        const selectedIndex = this.state.selectedIndex;
        const nextSensors = sensors.slice();
        nextSensors.splice(selectedIndex, 1);

        // Remove the deleted sensor's cache entry and shift remaining entries down so that
        // sensors which moved to a lower index still use their correct drafts.
        delete _draftCache[`${this.attr}_${selectedIndex}`];
        for (let i = selectedIndex + 1; i < sensors.length; i++) {
            const src = `${this.attr}_${i}`;
            const dst = `${this.attr}_${i - 1}`;
            if (_draftCache[src] !== undefined) {
                _draftCache[dst] = _draftCache[src];
            } else {
                delete _draftCache[dst];
            }
            delete _draftCache[src];
        }

        const nextIndex = Math.max(0, selectedIndex - 1);
        const nextSensor = nextSensors[nextIndex] || null;
        const nextDraft = _draftCache[`${this.attr}_${nextIndex}`] || cloneForDraft(nextSensor);

        this.setState({ selectedIndex: nextIndex, selectedDraft: nextDraft });
        this.updateSensors(nextSensors);
    };

    // Renders the read-only info box shown to non-expert users for a standard (non-JSON) sensor.
    private renderNonExpertStandardInfo(editSensor: Sensor): React.ReactNode {
        const t = I18n.t;
        const typeNames: Record<string, string> = {
            int: t('Integer'),
            float: t('Float'),
            bool: t('Boolean'),
            string: t('String'),
            '': t('Standard'),
        };
        const typeName = typeNames[editSensor.type || ''] || t('Standard');
        const measurement = editSensor.measurement || '?';
        const field = editSensor.field || '?';
        const sensorType = editSensor.type || '';
        const timeoutMin = editSensor.aliveTimeoutMinutes != null ? editSensor.aliveTimeoutMinutes : 60;
        const timeoutDisabled = timeoutMin === 0;
        const splitTpl = (tpl: string, placeholder: string): [string, string] => {
            const parts = tpl.split(placeholder);
            return [parts[0] || '', parts[1] || ''];
        };
        const extractLines = (str: string): { status: string; hint: string } => {
            const lines = str.split('\n');
            return { status: lines[0], hint: lines.slice(1).join('\n') };
        };

        let monitoringStatusChildren: React.ReactNode[];
        let monitoringConfigHint: string;
        let monitoringActive: boolean;

        if (sensorType !== 'bool' && sensorType !== 'string') {
            const maxW = editSensor.maxValue != null ? editSensor.maxValue : 0;
            const maxDisabled = maxW <= 0;
            if (maxDisabled && timeoutDisabled) {
                const dl = extractLines(t('nonExpertMonitoringDisabled'));
                monitoringStatusChildren = [dl.status];
                monitoringConfigHint = dl.hint;
                monitoringActive = false;
            } else if (maxDisabled) {
                const tl = extractLines(t('nonExpertMonitoringInfo'));
                const tp = splitTpl(tl.status, '%TIMEOUTSTR%');
                monitoringStatusChildren = [tp[0], <strong key="tv">{timeoutMin} min</strong>, tp[1]];
                monitoringConfigHint = tl.hint;
                monitoringActive = true;
            } else {
                const timeoutStr = timeoutDisabled ? t('nonExpertTimeoutDisabledShort') : `${timeoutMin} min`;
                const fl = extractLines(t('nonExpertMonitoringInfoFull'));
                const mp = splitTpl(fl.status, '%MAXWSTR%');
                const tp2 = splitTpl(mp[1], '%TIMEOUTSTR%');
                const unitStr = ` ${editSensor.unit || 'W'}`;
                monitoringStatusChildren = [
                    mp[0],
                    <strong key="mv">
                        {maxW}
                        {unitStr}
                    </strong>,
                    tp2[0],
                    <strong key="tv">{timeoutStr}</strong>,
                    tp2[1],
                ];
                monitoringConfigHint = fl.hint;
                monitoringActive = true;
            }
        } else if (timeoutDisabled) {
            const dl2 = extractLines(t('nonExpertMonitoringDisabled'));
            monitoringStatusChildren = [dl2.status];
            monitoringConfigHint = dl2.hint;
            monitoringActive = false;
        } else {
            const tl2 = extractLines(t('nonExpertMonitoringInfo'));
            const tp3 = splitTpl(tl2.status, '%TIMEOUTSTR%');
            monitoringStatusChildren = [tp3[0], <strong key="tv">{timeoutMin} min</strong>, tp3[1]];
            monitoringConfigHint = tl2.hint;
            monitoringActive = true;
        }

        const siTemplate = t('nonExpertSensorInfo');
        const typeSplit = siTemplate.split('%TYPE%');
        const mfSplit = (typeSplit[1] || '').split('%MF%');
        const monitoringColor = monitoringActive ? MONITORING_ACTIVE_COLOR : MONITORING_DISABLED_COLOR;

        return (
            <>
                <span key="si">
                    {typeSplit[0]}
                    <strong key="type">{typeName}</strong>
                    {mfSplit[0]}
                    <strong key="meas">{measurement}</strong>:<strong key="field">{field}</strong>
                    {mfSplit[1] || ''}
                </span>
                {'\n'}
                <span key="hint">{t('nonExpertExpertHint')}</span>
                {'\n'}
                <span key="monitoring" style={{ color: monitoringColor }}>
                    {monitoringStatusChildren}
                </span>
                {monitoringConfigHint ? '\n' : null}
                {monitoringConfigHint ? <span key="monitoringHint">{monitoringConfigHint}</span> : null}
            </>
        );
    }

    // Renders the read-only info box shown to non-expert users for a JSON sensor.
    private renderNonExpertJsonInfo(editSensor: Sensor): React.ReactNode {
        const t = I18n.t;
        const name = (editSensor.SensorName || '').toUpperCase();
        const presetKey = name.indexOf('CLEARSKY') >= 0 ? 'clearsky' : name.indexOf('TEMP') >= 0 ? 'temperature' : 'forecast';
        const preset = JSON_PRESETS[presetKey];
        const m = editSensor.measurement || preset.measurement;
        const f = editSensor.field || preset.field;
        const timeoutMin = editSensor.aliveTimeoutMinutes != null ? editSensor.aliveTimeoutMinutes : 60;
        const timeoutActive = timeoutMin > 0;
        const monitoringColor = timeoutActive ? MONITORING_ACTIVE_COLOR : MONITORING_DISABLED_COLOR;
        let timeoutStatusChildren: React.ReactNode[];
        let timeoutConfigHint: string;
        if (!timeoutActive) {
            const dl = t('nonExpertMonitoringDisabled').split('\n');
            timeoutStatusChildren = [dl[0]];
            timeoutConfigHint = dl.slice(1).join('\n');
        } else {
            const tl = t('nonExpertMonitoringInfo').split('\n');
            const tp = tl[0].split('%TIMEOUTSTR%');
            timeoutStatusChildren = [tp[0], <strong key="tv">{timeoutMin} min</strong>, tp[1] || ''];
            timeoutConfigHint = tl.slice(1).join('\n');
        }
        const jsonTemplate = t('nonExpertJsonInfo');
        const jsonSplit = jsonTemplate.split('%MAPPING%');
        const mappingPrefix = `${preset.valField} → `;
        const mappingDesc = ` (${t(preset.valDesc)})`;

        return (
            <>
                <span key="ji">
                    {jsonSplit[0] || ''}
                    {mappingPrefix}
                    <strong key="meas">{m}</strong>:<strong key="field">{f}</strong>
                    {mappingDesc}
                    {jsonSplit[1] || ''}
                </span>
                {'\n'}
                <span key="hint">{t('nonExpertExpertHint')}</span>
                {'\n'}
                <span key="monitoring" style={{ color: monitoringColor }}>
                    {timeoutStatusChildren}
                </span>
                {timeoutConfigHint ? '\n' : null}
                {timeoutConfigHint ? <span key="monitoringHint">{timeoutConfigHint}</span> : null}
            </>
        );
    }

    renderItem(): React.JSX.Element {
        const oContext = this.props.oContext;
        const themeType = oContext.themeType;
        const isDark = themeType === 'dark';
        const colors = isDark
            ? {
                  panelBg: '#1f1f1f',
                  panelBg2: '#242424',
                  text: '#ffffff',
                  textMuted: 'rgba(255,255,255,0.75)',
                  border: 'rgba(255,255,255,0.16)',
                  rowBorder: 'rgba(255,255,255,0.10)',
                  hover: 'rgba(255,255,255,0.06)',
                  active: 'rgba(255,255,255,0.10)',
              }
            : {
                  panelBg: '#ffffff',
                  panelBg2: '#ffffff',
                  text: '#111111',
                  textMuted: 'rgba(0,0,0,0.70)',
                  border: 'rgba(0,0,0,0.15)',
                  rowBorder: 'rgba(0,0,0,0.10)',
                  hover: 'rgba(0,0,0,0.05)',
                  active: 'rgba(0,0,0,0.08)',
              };

        const t = I18n.t;
        const expertMode = this.expertMode;
        const sensors = this.sensors;
        const selectedIndex = this.state.selectedIndex;
        const selectedSensor = this.selectedSensor;
        const editSensor: Sensor = this.state.selectedDraft || selectedSensor || {};
        const socket = oContext.socket;
        const theme = oContext.theme;

        const rootStyle: React.CSSProperties = {
            display: 'flex',
            gap: 12,
            width: '100%',
            minHeight: 360,
            height: '70vh',
            color: colors.text,
            position: 'relative',
            alignItems: 'stretch',
        };
        const leftStyle: React.CSSProperties = {
            width: 340,
            maxWidth: '40%',
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: colors.panelBg,
            height: '100%',
        };
        const rightStyle: React.CSSProperties = {
            flex: 1,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 12,
            background: colors.panelBg2,
            height: '100%',
            overflow: 'auto',
        };
        const toolbarStyle: React.CSSProperties = {
            display: 'flex',
            gap: 8,
            padding: 10,
            borderBottom: `1px solid ${colors.rowBorder}`,
            flexWrap: 'wrap',
        };
        const listStyle: React.CSSProperties = { overflowY: 'auto', overflowX: 'hidden', flex: 1 };
        const btnStyle: React.CSSProperties = {
            padding: '6px 10px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            cursor: 'pointer',
            color: colors.text,
        };
        const folderBtnStyle: React.CSSProperties = {
            width: '100%',
            textAlign: 'left',
            padding: '10px 10px',
            border: 'none',
            borderBottom: `1px solid ${colors.rowBorder}`,
            background: colors.panelBg,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            overflow: 'hidden',
            color: colors.text,
        };
        const folderItemStyle: React.CSSProperties = {
            width: '100%',
            textAlign: 'left',
            padding: '10px 10px 10px 30px',
            border: 'none',
            borderBottom: `1px solid ${colors.rowBorder}`,
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            overflow: 'hidden',
            color: colors.text,
        };
        const folderItemActiveStyle: React.CSSProperties = { ...folderItemStyle, background: colors.active };
        const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: colors.textMuted, marginTop: 10 };
        const inputStyle: React.CSSProperties = {
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            fontFamily: 'inherit',
            fontSize: 14,
            color: colors.text,
            background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
        };
        const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
        const infoBoxStyle: React.CSSProperties = {
            marginTop: 12,
            padding: 12,
            borderRadius: 6,
            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
            fontSize: 13,
            color: colors.textMuted,
            lineHeight: 1.6,
            whiteSpace: 'pre-line',
        };

        const editType = editSensor.type || '';
        const hasMaxTimeoutRow = expertMode && editType !== 'json' && editType !== 'bool' && editType !== 'string';

        return (
            <div style={rootStyle}>
                <div style={leftStyle}>
                    {expertMode ? (
                        <div style={toolbarStyle}>
                            <button type="button" style={btnStyle} onClick={this.addSensor}>
                                {t('Add')}
                            </button>
                            <button type="button" style={btnStyle} onClick={this.cloneSelected} disabled={!selectedSensor}>
                                {t('Duplicate')}
                            </button>
                            <button type="button" style={btnStyle} onClick={this.deleteSelected} disabled={!selectedSensor}>
                                {t('Delete')}
                            </button>
                            <button type="button" style={btnStyle} onClick={() => this.moveSelected(-1)} disabled={selectedIndex <= 0}>
                                {t('Up')}
                            </button>
                            <button
                                type="button"
                                style={btnStyle}
                                onClick={() => this.moveSelected(1)}
                                disabled={selectedIndex >= sensors.length - 1}
                            >
                                {t('Down')}
                            </button>
                        </div>
                    ) : null}
                    <div style={listStyle}>
                        {sensors.length ? (
                            this.groupedSensors.map(folder => {
                                const folderStateKey = folder.key || '__ungrouped__';
                                const isCollapsed = !!this.state.collapsedFolders[folderStateKey];
                                return (
                                    <React.Fragment key={folderStateKey}>
                                        <button type="button" style={folderBtnStyle} onClick={() => this.toggleFolder(folder.key)}>
                                            <span style={{ width: 20, fontSize: 14 }}>{isCollapsed ? '▶' : '▼'}</span>
                                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {folder.label}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                    padding: '2px 8px',
                                                    borderRadius: 999,
                                                    background: colors.active,
                                                    color: colors.textMuted,
                                                }}
                                            >
                                                {folder.items.length}
                                            </span>
                                        </button>
                                        {!isCollapsed
                                            ? folder.items.map(({ sensor, index }) => (
                                                  <button
                                                      key={index}
                                                      type="button"
                                                      style={index === selectedIndex ? folderItemActiveStyle : folderItemStyle}
                                                      onClick={() => this.setState({ selectedIndex: index })}
                                                  >
                                                      <span
                                                          style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                          title={sensor.SensorName || t('Unnamed')}
                                                      >
                                                          {calcTitle(sensor)}
                                                      </span>
                                                  </button>
                                              ))
                                            : null}
                                    </React.Fragment>
                                );
                            })
                        ) : (
                            <div style={{ padding: 12, opacity: 0.9, color: colors.textMuted }}>{t('No sensors configured.')}</div>
                        )}
                    </div>
                </div>
                <div style={rightStyle}>
                    {selectedSensor ? (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 16, fontWeight: 700 }}>{calcTitle(editSensor)}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                            type="checkbox"
                                            checked={!!selectedSensor.enabled}
                                            onChange={e => this.updateSelected('enabled', !!e.target.checked)}
                                        />
                                        <span>{t('Enabled')}</span>
                                    </label>
                                    {expertMode ? (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!editSensor.internal}
                                                onChange={e => {
                                                    const isChecked = !!e.target.checked;
                                                    this.setDraftField('internal', isChecked);
                                                    const nextForTitle = { ...(selectedSensor || {}), internal: isChecked };
                                                    this.updateSelectedMulti({ internal: isChecked, _title: calcTitle(nextForTitle) });
                                                }}
                                            />
                                            <span>{t('Internal')}</span>
                                        </label>
                                    ) : null}
                                </div>
                            </div>
                            {expertMode ? (
                                <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>{t('internalSensorHint')}</div>
                            ) : null}
                            {expertMode ? (
                                <>
                                    <label style={labelStyle}>{t('Sensor Name')}</label>
                                    <input
                                        style={inputStyle}
                                        type="text"
                                        value={editSensor.SensorName || ''}
                                        onChange={e => this.setDraftField('SensorName', e.target.value)}
                                        onBlur={e => this.updateSelected('SensorName', e.target.value)}
                                    />
                                    <label style={labelStyle}>{t('Folder/Group')}</label>
                                    <input
                                        style={inputStyle}
                                        type="text"
                                        value={sensorGroupInputValue(editSensor.group)}
                                        onChange={e => this.setDraftField('group', e.target.value)}
                                        onBlur={e => {
                                            const nextGroup = canonicalizeSensorGroupName(e.target.value);
                                            this.setDraftField('group', sensorGroupInputValue(nextGroup));
                                            this.updateSelected('group', nextGroup);
                                        }}
                                        placeholder="pv"
                                    />
                                </>
                            ) : null}
                            <label style={labelStyle}>{t('ioBroker Source State')}</label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input
                                    style={{ ...inputStyle, flex: 1 }}
                                    type="text"
                                    value={editSensor.sourceState || ''}
                                    onChange={e => this.setDraftField('sourceState', e.target.value)}
                                    onBlur={e => {
                                        const stateId = e.target.value;
                                        this.updateSelected('sourceState', stateId);
                                        this.autoDetectUnit(stateId, selectedIndex);
                                    }}
                                    placeholder={t('e.g. some.adapter.0.channel.state')}
                                />
                                <button
                                    type="button"
                                    style={{ ...btnStyle, padding: '8px 10px' }}
                                    disabled={!(socket && theme)}
                                    title={socket && theme ? t('Select from existing states') : t('Selection dialog not available')}
                                    onClick={() => this.setState({ showSelectStateId: true })}
                                >
                                    {t('Select')}
                                </button>
                            </div>
                            {hasMaxTimeoutRow ? (
                                <div style={rowStyle}>
                                    <div>
                                        <label style={labelStyle}>{t('Unit')}</label>
                                        <input
                                            style={{ ...inputStyle, maxWidth: 120 }}
                                            type="text"
                                            value={editSensor.unit || ''}
                                            placeholder="W"
                                            onChange={e => this.setDraftField('unit', e.target.value)}
                                            onBlur={e => this.updateSelected('unit', e.target.value)}
                                        />
                                        <label style={labelStyle}>{t('Max Value')}</label>
                                        <input
                                            style={inputStyle}
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={editSensor.maxValue !== undefined && editSensor.maxValue !== null ? editSensor.maxValue : ''}
                                            placeholder={t('e.g. 0')}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                const parsed = Number(raw);
                                                this.setDraftField('maxValue', raw === '' || !Number.isFinite(parsed) ? undefined : parsed);
                                            }}
                                            onBlur={e => {
                                                const raw = e.target.value;
                                                const parsed = Number(raw);
                                                this.updateSelected('maxValue', raw === '' || !Number.isFinite(parsed) ? undefined : parsed);
                                            }}
                                        />
                                        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{t('maxValueHint')}</div>
                                    </div>
                                    <div>
                                        <label style={labelStyle}>{t('aliveTimeoutMinutesLabel')}</label>
                                        <input
                                            style={inputStyle}
                                            type="number"
                                            min="0"
                                            value={editSensor.aliveTimeoutMinutes != null ? editSensor.aliveTimeoutMinutes : ''}
                                            placeholder={t('e.g. 60')}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                const parsed = parseInt(raw, 10);
                                                this.setDraftField('aliveTimeoutMinutes', raw === '' ? null : Number.isFinite(parsed) ? parsed : null);
                                            }}
                                            onBlur={e => {
                                                const raw = e.target.value;
                                                const parsed = parseInt(raw, 10);
                                                this.updateSelected('aliveTimeoutMinutes', raw === '' || !Number.isFinite(parsed) ? 60 : parsed);
                                            }}
                                        />
                                        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{t('aliveTimeoutHint')}</div>
                                    </div>
                                </div>
                            ) : expertMode ? (
                                <div>
                                    <label style={labelStyle}>{t('aliveTimeoutMinutesLabel')}</label>
                                    <input
                                        style={{ ...inputStyle, maxWidth: 200 }}
                                        type="number"
                                        min="0"
                                        value={editSensor.aliveTimeoutMinutes != null ? editSensor.aliveTimeoutMinutes : ''}
                                        placeholder={t('e.g. 60')}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            const parsed = parseInt(raw, 10);
                                            this.setDraftField('aliveTimeoutMinutes', raw === '' ? null : Number.isFinite(parsed) ? parsed : null);
                                        }}
                                        onBlur={e => {
                                            const raw = e.target.value;
                                            const parsed = parseInt(raw, 10);
                                            this.updateSelected('aliveTimeoutMinutes', raw === '' || !Number.isFinite(parsed) ? 60 : parsed);
                                        }}
                                    />
                                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{t('aliveTimeoutHint')}</div>
                                </div>
                            ) : null}
                            {expertMode ? (
                                <>
                                    <label style={labelStyle}>{t('Datatype')}</label>
                                    <select
                                        style={{ ...inputStyle, maxWidth: 300 }}
                                        value={editSensor.type || ''}
                                        onChange={e => {
                                            const newType = e.target.value;
                                            this.setDraftField('type', newType);
                                            if (newType === 'json') {
                                                this.setDraftField('jsonPreset', 'auto');
                                            }
                                            setTimeout(() => {
                                                if (newType === 'json') {
                                                    this.updateSelectedMulti({ type: 'json', jsonPreset: 'auto' });
                                                } else {
                                                    this.updateSelected('type', newType);
                                                }
                                            }, 0);
                                        }}
                                    >
                                        <option value="">{t('Standard')}</option>
                                        <option value="int">{t('Integer')}</option>
                                        <option value="float">{t('Float')}</option>
                                        <option value="bool">{t('Boolean')}</option>
                                        <option value="string">{t('String')}</option>
                                        <option value="json">{t('JSON Array')}</option>
                                    </select>
                                </>
                            ) : null}
                            {!expertMode && editType !== 'json' ? <div style={infoBoxStyle}>{this.renderNonExpertStandardInfo(editSensor)}</div> : null}
                            {!expertMode && editType === 'json' ? <div style={infoBoxStyle}>{this.renderNonExpertJsonInfo(editSensor)}</div> : null}
                            {expertMode && editType === 'json' ? (
                                <>
                                    <label style={labelStyle}>{t('JSON Preset')}</label>
                                    <select
                                        style={{ ...inputStyle, maxWidth: 300 }}
                                        value={editSensor.jsonPreset || 'auto'}
                                        onChange={e => {
                                            const preset = e.target.value;
                                            this.setDraftField('jsonPreset', preset);
                                            setTimeout(() => this.updateSelected('jsonPreset', preset), 0);
                                        }}
                                    >
                                        <option value="auto">{t('Automatic')}</option>
                                        <option value="custom">{t('Custom')}</option>
                                    </select>
                                    {(editSensor.jsonPreset || 'auto') === 'auto' ? (
                                        <div
                                            style={{
                                                marginTop: 8,
                                                padding: 10,
                                                borderRadius: 6,
                                                background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                                                fontSize: 13,
                                                color: colors.textMuted,
                                                lineHeight: 1.6,
                                                fontFamily: 'monospace',
                                                whiteSpace: 'pre-line',
                                            }}
                                        >
                                            {t('jsonAutoDetectInfo')}
                                        </div>
                                    ) : null}
                                    {(editSensor.jsonPreset || 'auto') === 'custom' ? (
                                        <>
                                            <div style={rowStyle}>
                                                <div>
                                                    <label style={labelStyle}>{t('JSON Timestamp Field')}</label>
                                                    <input
                                                        style={inputStyle}
                                                        type="text"
                                                        value={editSensor.jsonTsField || 't'}
                                                        placeholder="t"
                                                        onChange={e => this.setDraftField('jsonTsField', e.target.value)}
                                                        onBlur={e => this.updateSelected('jsonTsField', e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={labelStyle}>{t('JSON Value Field')}</label>
                                                    <input
                                                        style={inputStyle}
                                                        type="text"
                                                        value={editSensor.jsonValField || 'y'}
                                                        placeholder="y"
                                                        onChange={e => this.setDraftField('jsonValField', e.target.value)}
                                                        onBlur={e => this.updateSelected('jsonValField', e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <label style={labelStyle}>{t('Influx Type')}</label>
                                            <select
                                                style={{ ...inputStyle, maxWidth: 200 }}
                                                value={editSensor.jsonInfluxType || 'float'}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    this.setDraftField('jsonInfluxType', val);
                                                    setTimeout(() => this.updateSelected('jsonInfluxType', val), 0);
                                                }}
                                            >
                                                <option value="int">{t('Integer')}</option>
                                                <option value="float">{t('Float')}</option>
                                            </select>
                                        </>
                                    ) : null}
                                    <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', fontSize: 13, color: colors.textMuted, lineHeight: 1.5 }}>
                                        {t('jsonSensorDetailHint')}
                                    </div>
                                </>
                            ) : null}
                            {expertMode ? (
                                <div style={rowStyle}>
                                    <div>
                                        <label style={labelStyle}>{t('Influx Measurement')}</label>
                                        <input
                                            style={inputStyle}
                                            type="text"
                                            value={editSensor.measurement || ''}
                                            onChange={e => this.setDraftField('measurement', e.target.value)}
                                            onBlur={e => this.updateSelected('measurement', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>{t('Influx Field')}</label>
                                        <input
                                            style={inputStyle}
                                            type="text"
                                            value={editSensor.field || ''}
                                            onChange={e => this.setDraftField('field', e.target.value)}
                                            onBlur={e => this.updateSelected('field', e.target.value)}
                                        />
                                    </div>
                                </div>
                            ) : null}
                            {this.state.showSelectStateId && socket && theme ? (
                                <DialogSelectID
                                    key="selectStateId"
                                    imagePrefix="../.."
                                    dialogName={oContext.adapterName || 'solectrus-influxdb'}
                                    themeType={themeType}
                                    theme={theme}
                                    socket={socket}
                                    types="state"
                                    selected={selectedSensor.sourceState || ''}
                                    onClose={() => this.setState({ showSelectStateId: false })}
                                    onOk={selected => {
                                        const selectedStr = Array.isArray(selected) ? selected[0] : selected;
                                        this.setState({ showSelectStateId: false });
                                        if (selectedStr) {
                                            this.setDraftField('sourceState', selectedStr);
                                            this.updateSelected('sourceState', selectedStr);
                                            this.autoDetectUnit(selectedStr, selectedIndex);
                                        }
                                    }}
                                />
                            ) : null}
                        </>
                    ) : (
                        <div style={{ opacity: 0.9, color: colors.textMuted }}>{t('Select a sensor on the left or add a new one.')}</div>
                    )}
                </div>
            </div>
        );
    }
}
