/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Minimal Module Federation remote container for ioBroker Admin jsonConfig "custom" control.
// Exposes: SolectrusSensors/Components -> default export is an object containing { SolectrusSensorsEditor }.
(function () {
    'use strict';

    const REMOTE_NAME = 'SolectrusSensors';
    const UI_VERSION = '2026-01-18 20260118-1';
    const DEBUG = false;
    let shareScope;

    if (DEBUG && typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug(`[${REMOTE_NAME}] custom remote loaded`);
    }

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
        // Handle both CommonJS and ESM interop shapes
        return mod && mod.__esModule && mod.default ? mod.default : mod;
    }

    function normalizeSensors(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(sensor) {
        const sensorName = sensor && sensor.SensorName ? sensor.SensorName : 'Sensor';
        const enabled = !!(sensor && sensor.enabled);
        return `${enabled ? '🟢 ' : '⚪ '}${sensorName}`;
    }

    function ensureTitle(sensor) {
        return Object.assign({}, sensor || {}, { _title: calcTitle(sensor || {}) });
    }

    function makeNewSensor() {
        const sensor = {
            enabled: false,
            SensorName: '',
            sourceState: '',
            type: '',
            measurement: 'solectrus',
            field: '',
        };
        return ensureTitle(sensor);
    }

    function createSolectrusSensorsEditor(React, AdapterReact) {
        return function SolectrusSensorsEditor(props) {
            const attr = (props && typeof props.attr === 'string' && props.attr) ? props.attr : 'sensors';
            const dataIsArray = Array.isArray(props && props.data);
            const dataIsObject = !!(props && props.data && typeof props.data === 'object' && !dataIsArray);

            const getThemeType = () => {
                if (props && typeof props.themeType === 'string' && props.themeType) {
                    return props.themeType;
                }
                const mode = props && props.theme && props.theme.palette && props.theme.palette.mode;
                if (mode === 'dark' || mode === 'light') {
                    return mode;
                }
                try {
                    const doc = globalThis.document;
                    const htmlTheme = doc && doc.documentElement ? doc.documentElement.getAttribute('data-theme') : '';
                    if (htmlTheme === 'dark' || htmlTheme === 'light') {
                        return htmlTheme;
                    }
                    const body = doc ? doc.body : null;
                    if (body && body.classList) {
                        if (body.classList.contains('mui-theme-dark') || body.classList.contains('iob-theme-dark')) {
                            return 'dark';
                        }
                        if (body.classList.contains('mui-theme-light') || body.classList.contains('iob-theme-light')) {
                            return 'light';
                        }
                    }
                } catch {
                    // ignore
                }
                return '';
            };

            const themeType = getThemeType();
            // Do NOT fall back to prefers-color-scheme here: ioBroker Admin theme must win.
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

            const DialogSelectID = AdapterReact && (AdapterReact.DialogSelectID || AdapterReact.SelectID);

            const socket = (props && props.socket) || globalThis.socket || globalThis._socket || null;
            const theme = (props && props.theme) || null;

            const t = text => {
                try {
                    if (props && typeof props.t === 'function') {
                        return props.t(text);
                    }
                } catch {
                    // ignore
                }

                const I18n =
                    (AdapterReact && AdapterReact.I18n) ||
                    globalThis.I18n ||
                    (globalThis.window && globalThis.window.I18n);

                try {
                    if (I18n && typeof I18n.t === 'function') {
                        return I18n.t(text);
                    }
                    if (I18n && typeof I18n.getTranslation === 'function') {
                        return I18n.getTranslation(text);
                    }
                } catch {
                    // ignore
                }

                return text;
            };

            // Admin versions differ:
            // - Some pass `props.data` as the full native object (then `attr` selects the field).
            // - Some pass `props.data` directly as the field value (sensors array).
            const sensors = dataIsArray
                ? normalizeSensors(props.data)
                : normalizeSensors(props.data && props.data[attr]);

            const [selectedIndex, setSelectedIndex] = React.useState(0);
            const [showSelectStateId, setShowSelectStateId] = React.useState(false);

            React.useEffect(() => {
                if (selectedIndex > sensors.length - 1) {
                    setSelectedIndex(Math.max(0, sensors.length - 1));
                }
            }, [sensors.length, selectedIndex]);

            React.useEffect(() => {
                if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                    const dataKeys = props && props.data && typeof props.data === 'object' && !Array.isArray(props.data)
                        ? Object.keys(props.data)
                        : [];
                    console.info('[SolectrusSensorsEditor] mounted', {
                        version: UI_VERSION,
                        attr,
                        propsAttr: props && props.attr,
                        dataType: Array.isArray(props && props.data) ? 'array' : typeof (props && props.data),
                        dataKeys,
                        custom: !!(props && props.custom),
                        hasForceUpdate: !!(props && typeof props.forceUpdate === 'function'),
                        onChangeType: typeof (props && props.onChange),
                        onChangeLength: props && typeof props.onChange === 'function' ? props.onChange.length : undefined,
                        themeType: props && props.themeType,
                        derivedThemeType: themeType,
                        hasTheme: !!(props && props.theme),
                        hasSocket: !!(props && props.socket),
                        hasGlobalSocket: !!(globalThis.socket || globalThis._socket),
                        hasDialogSelectId: !!DialogSelectID,
                    });
                }
            }, []);

            const updateSensors = nextSensors => {
                if (typeof props.onChange !== 'function') {
                    return;
                }

                const onChange = props.onChange;

                const cb = () => {
                    try {
                        if (props && typeof props.forceUpdate === 'function') {
                            props.forceUpdate([attr], props.data);
                        }
                    } catch {
                        // ignore
                    }
                };

                const callOnChange = (label, ...args) => {
                    try {
                        if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                            const dataKeys = dataIsObject ? Object.keys(props.data || {}) : [];
                            console.info('[SolectrusSensorsEditor] onChange', {
                                label,
                                attr,
                                custom: !!(props && props.custom),
                                dataType: dataIsArray ? 'array' : typeof (props && props.data),
                                dataKeys,
                                nextSensorsLength: Array.isArray(nextSensors) ? nextSensors.length : undefined,
                                onChangeLength: typeof onChange === 'function' ? onChange.length : undefined,
                            });
                        }
                        onChange(...args);
                    } catch (e) {
                        if (typeof console !== 'undefined' && typeof console.error === 'function') {
                            console.error('[SolectrusSensorsEditor] onChange failed', e);
                        }
                    }
                };

                // JsonConfig (modern Admin) passes:
                // - props.data: the full data object (e.g., adapter native)
                // - props.attr: the path/key for this control within `data`
                // And expects changes as:
                // - adapter-config mode: onChange(updatedDataObject, ...)
                // - object-custom mode (`props.custom === true`): onChange(attr, value, ...)
                const setByPath = (rootObj, path, value) => {
                    if (!path) {
                        return value;
                    }

                    const parts = String(path).split('.').filter(Boolean);
                    const clonedRoot = Array.isArray(rootObj)
                        ? rootObj.slice()
                        : Object.assign({}, rootObj || {});
                    let cursor = clonedRoot;

                    for (let i = 0; i < parts.length - 1; i++) {
                        const part = parts[i];
                        const isArrayIndex = Array.isArray(cursor) && /^\d+$/.test(part);
                        const key = isArrayIndex ? parseInt(part, 10) : part;
                        const existing = cursor[key];

                        const next = Array.isArray(existing)
                            ? existing.slice()
                            : existing && typeof existing === 'object'
                              ? Object.assign({}, existing)
                              : {};

                        cursor[key] = next;
                        cursor = next;
                    }

                    const last = parts[parts.length - 1];
                    const lastKey = Array.isArray(cursor) && /^\d+$/.test(last) ? parseInt(last, 10) : last;
                    cursor[lastKey] = value;

                    return clonedRoot;
                };

                if (props && props.custom) {
                    // In "custom object" mode JsonConfig expects: onChange(attr, value, cb?, saveConfig?)
                    callOnChange('custom-object attr/value', attr, nextSensors);
                    return;
                }

                // Adapter instance config mode (custom=false): JsonConfig expects full updated data object
                // as first argument: onChange(updatedDataObject, val?, cb?, saveConfig?)
                if (dataIsObject) {
                    const nextData = setByPath(props.data, attr, nextSensors);
                    if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                        console.info('[SolectrusSensorsEditor] nextData', {
                            keys: nextData && typeof nextData === 'object' ? Object.keys(nextData) : null,
                            hasInflux: !!(nextData && nextData.influx),
                            hasSensors: !!(nextData && nextData.sensors),
                        });
                    }
                    // IMPORTANT: In adapter config mode, pass only the full data object.
                    // Passing (attr, value) can be misinterpreted by some Admin builds and lead to setValue
                    // attempting to write into a string (e.g. "Cannot create property 'sensors' on string 'sensors'").
                    callOnChange('adapter-config full-data', nextData);
                    cb();
                    return;
                }

                // Legacy fallback: some environments may pass the field value directly.
                callOnChange('legacy value-only', nextSensors);
            };

            const selectedSensor = sensors[selectedIndex] || null;

            const updateSelected = (field, value) => {
                const nextSensors = sensors.map((s, i) => {
                    if (i !== selectedIndex) return s;
                    const next = Object.assign({}, s || {});
                    next[field] = value;
                    return ensureTitle(next);
                });
                updateSensors(nextSensors);
            };

            const moveSelected = direction => {
                const from = selectedIndex;
                const to = from + direction;
                if (to < 0 || to >= sensors.length) return;

                const nextSensors = sensors.slice();
                const tmp = nextSensors[from];
                nextSensors[from] = nextSensors[to];
                nextSensors[to] = tmp;

                updateSensors(nextSensors);
                setSelectedIndex(to);
            };

            const addSensor = () => {
                const nextSensors = sensors.concat([makeNewSensor()]);
                updateSensors(nextSensors);
                setSelectedIndex(nextSensors.length - 1);
            };

            const cloneSelected = () => {
                if (!selectedSensor) return;
                const clone = ensureTitle(Object.assign({}, selectedSensor));
                const nextSensors = sensors.slice();
                nextSensors.splice(selectedIndex + 1, 0, clone);
                updateSensors(nextSensors);
                setSelectedIndex(selectedIndex + 1);
            };

            const deleteSelected = () => {
                if (!selectedSensor) return;
                const nextSensors = sensors.slice();
                nextSensors.splice(selectedIndex, 1);
                updateSensors(nextSensors);
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            };

            const rootStyle = {
                display: 'flex',
                gap: 12,
                width: '100%',
                minHeight: 360,
                height: '70vh',
                color: colors.text,
                position: 'relative',
                alignItems: 'stretch',
            };

            const leftStyle = {
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

            const rightStyle = {
                flex: 1,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 12,
                background: colors.panelBg2,
                height: '100%',
                overflow: 'auto',
            };

            const toolbarStyle = {
                display: 'flex',
                gap: 8,
                padding: 10,
                borderBottom: `1px solid ${colors.rowBorder}`,
                flexWrap: 'wrap',
            };

            const listStyle = {
                overflowY: 'auto',
                overflowX: 'hidden',
                flex: 1,
            };

            const btnStyle = {
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                cursor: 'pointer',
                color: colors.text,
            };

            const listBtnStyle = isActive => ({
                width: '100%',
                textAlign: 'left',
                padding: '10px 10px',
                border: 'none',
                borderBottom: `1px solid ${colors.rowBorder}`,
                background: isActive ? colors.active : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                overflow: 'hidden',
                color: colors.text,
            });

            const labelStyle = { display: 'block', fontSize: 12, color: colors.textMuted, marginTop: 10 };
            const inputStyle = {
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                fontFamily: 'inherit',
                fontSize: 14,
                color: colors.text,
                background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
            };

            const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

            return React.createElement(
                'div',
                { style: rootStyle },
                DEBUG
                    ? React.createElement(
                          'div',
                          {
                              style: {
                                  position: 'absolute',
                                  right: 14,
                                  marginTop: -22,
                                  fontSize: 11,
                                  opacity: 0.7,
                                  color: colors.textMuted,
                                  pointerEvents: 'none',
                              },
                          },
                          `Sensors UI ${UI_VERSION}`
                      )
                    : null,
                React.createElement(
                    'div',
                    { style: leftStyle },
                    React.createElement(
                        'div',
                        { style: toolbarStyle },
                        React.createElement('button', { type: 'button', style: btnStyle, onClick: addSensor }, t('Add')),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: cloneSelected, disabled: !selectedSensor },
                            t('Duplicate')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: deleteSelected, disabled: !selectedSensor },
                            t('Delete')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 },
                            t('Up')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(1), disabled: selectedIndex >= sensors.length - 1 },
                            t('Down')
                        )
                    ),
                    React.createElement(
                        'div',
                        { style: listStyle },
                        sensors.length
                            ? sensors.map((s, i) =>
                                  React.createElement(
                                      'button',
                                      {
                                          key: i,
                                          type: 'button',
                                          style: listBtnStyle(i === selectedIndex),
                                          onClick: () => setSelectedIndex(i),
                                      },
                                      React.createElement('span', { style: { width: 22 } }, s.enabled ? '🟢' : '⚪'),
                                      React.createElement(
                                          'span',
                                          {
                                              style: {
                                                  fontWeight: 600,
                                                  flex: 1,
                                                  minWidth: 0,
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  whiteSpace: 'nowrap',
                                              },
                                              title: s.SensorName || t('Unnamed'),
                                          },
                                          s.SensorName || t('Unnamed')
                                      )
                                  )
                              )
                            : React.createElement(
                                  'div',
                                  { style: { padding: 12, opacity: 0.9, color: colors.textMuted } },
                                  t('No sensors configured.')
                              )
                    )
                ),
                React.createElement(
                    'div',
                    { style: rightStyle },
                    selectedSensor
                        ? React.createElement(
                              React.Fragment,
                              null,
                              React.createElement(
                                  'div',
                                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 16, fontWeight: 700 } },
                                      calcTitle(selectedSensor)
                                  ),
                                  React.createElement(
                                      'label',
                                      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                      React.createElement('input', {
                                          type: 'checkbox',
                                          checked: !!selectedSensor.enabled,
                                          onChange: e => updateSelected('enabled', !!e.target.checked),
                                      }),
                                      React.createElement('span', null, t('Enabled'))
                                  )
                              ),
                              React.createElement('label', { style: labelStyle }, t('Sensor Name')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedSensor.SensorName || '',
                                  onChange: e => updateSelected('SensorName', e.target.value),
                              }),
                              React.createElement(
                                  'label',
                                  { style: labelStyle },
                                  t('ioBroker Source State')
                              ),
                              React.createElement(
                                  'div',
                                  { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                                  React.createElement('input', {
                                      style: Object.assign({}, inputStyle, { flex: 1 }),
                                      type: 'text',
                                      value: selectedSensor.sourceState || '',
                                      onChange: e => updateSelected('sourceState', e.target.value),
                                      placeholder: t('e.g. some.adapter.0.channel.state'),
                                  }),
                                  React.createElement(
                                      'button',
                                      {
                                          type: 'button',
                                          style: Object.assign({}, btnStyle, { padding: '8px 10px' }),
                                          disabled: !(DialogSelectID && socket && theme),
                                          title: DialogSelectID && socket && theme
                                              ? t('Select from existing states')
                                              : t('Selection dialog not available')
                                          ,
                                          onClick: () => {
                                              if (!(DialogSelectID && socket && theme)) {
                                                  if (DEBUG && typeof console !== 'undefined' && typeof console.warn === 'function') {
                                                      console.warn('[SolectrusSensorsEditor] SelectID not available', {
                                                          version: UI_VERSION,
                                                          hasDialogSelectId: !!DialogSelectID,
                                                          hasSocket: !!socket,
                                                          hasTheme: !!theme,
                                                          propsThemeType: props && props.themeType,
                                                          derivedThemeType: themeType,
                                                      });
                                                  }
                                              }
                                              setShowSelectStateId(true);
                                          },
                                      },
                                      t('Select')
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  { style: rowStyle },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Datatype')),
                                      React.createElement(
                                          'select',
                                          {
                                              style: inputStyle,
                                              value: selectedSensor.type || '',
                                              onChange: e => updateSelected('type', e.target.value),
                                          },
                                          React.createElement('option', { value: '' }, t('Standard')),
                                          React.createElement('option', { value: 'int' }, t('Integer')),
                                          React.createElement('option', { value: 'float' }, t('Float')),
                                          React.createElement('option', { value: 'bool' }, t('Boolean')),
                                          React.createElement('option', { value: 'string' }, t('String'))
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Influx Measurement')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: selectedSensor.measurement || '',
                                          onChange: e => updateSelected('measurement', e.target.value),
                                      })
                                  )
                              ),
                              React.createElement('label', { style: labelStyle }, t('Influx Field')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedSensor.field || '',
                                  onChange: e => updateSelected('field', e.target.value),
                              }),
                              showSelectStateId && DialogSelectID && socket && theme
                                  ? React.createElement(DialogSelectID, {
                                        key: 'selectStateId',
                                        imagePrefix: '../..',
                                        dialogName: (props && (props.adapterName || props.adapter)) || 'solectrus-influxdb',
                                        themeType: themeType || (props && props.themeType),
                                        theme: theme,
                                        socket: socket,
                                        types: 'state',
                                        selected: selectedSensor.sourceState || '',
                                        onClose: () => setShowSelectStateId(false),
                                        onOk: selected => {
                                            const selectedStr = Array.isArray(selected) ? selected[0] : selected;
                                            setShowSelectStateId(false);
                                            if (selectedStr) {
                                                updateSelected('sourceState', selectedStr);
                                            }
                                        },
                                    })
                                  : null
                          )
                        : React.createElement(
                              'div',
                              { style: { opacity: 0.9, color: colors.textMuted } },
                              t('Select a sensor on the left or add a new one.')
                          )
                )
            );
        };
    }

    const moduleMap = {
        './Components': async function () {
            const React = globalThis.React || (await loadShared('react'));
            const AdapterReact = await loadShared('@iobroker/adapter-react-v5');
            if (!React) {
                throw new Error(
                    'SolectrusSensors custom UI: React not available (neither global nor via shared scope).'
                );
            }
            const SolectrusSensorsEditor = createSolectrusSensorsEditor(React, AdapterReact);
            return {
                default: {
                    SolectrusSensorsEditor,
                },
            };
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
/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Custom Master/Detail editor for ioBroker Admin jsonConfig.
// - Supports both modern (module federation) and legacy (global customComponents) loading.
// - Exposes: DataSolectrusItems/Components -> default export object containing { DataSolectrusItemsEditor }.
(function () {
    'use strict';

    const REMOTE_NAME = 'DataSolectrusItems';
    const UI_VERSION = '2026-02-04 20260204-1';
    const DEBUG = false;
    let shareScope;

        // Neutral (self-created) inline logo for the editor header.
        // Intentionally NOT using third-party trademarks/logos.
        const HEADER_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffb000"/>
            <stop offset="1" stop-color="#ff5a00"/>
        </linearGradient>
    </defs>
    <rect x="12" y="18" width="104" height="92" rx="18" fill="#1f2937"/>
    <circle cx="44" cy="56" r="16" fill="url(#g)"/>
    <path d="M44 34v-8M44 86v-8M22 56h-8M74 56h-8M29 41l-6-6M65 77l-6-6M29 71l-6 6M65 35l-6 6" stroke="#ffb000" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
    <path d="M78 44h26M78 58h26M78 72h26" stroke="#93c5fd" stroke-width="6" stroke-linecap="round"/>
    <path d="M78 88h18" stroke="#34d399" stroke-width="6" stroke-linecap="round"/>
</svg>`;

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

    function normalizeItems(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(item, t) {
        const enabled = !!(item && item.enabled);
        const group = item && item.group ? String(item.group).trim() : '';
        const targetId = item && item.targetId ? String(item.targetId).trim() : '';
        const id = (group && targetId) ? `${group}.${targetId}` : (targetId || group);
        const name = item && (item.name || id) ? String(item.name || id) : (t ? t('Item') : 'Item');
        return `${enabled ? '🟢 ' : '⚪ '}${name}`;
    }

    function ensureTitle(item, t) {
        return Object.assign({}, item || {}, { _title: calcTitle(item || {}, t) });
    }

    function makeNewItem(t) {
        const item = {
            enabled: false,
            name: '',
            group: '',
            targetId: '',
            mode: 'formula',
            sourceState: '',
            jsonPath: '',
            inputs: [],
            formula: '',
            type: '',
            role: '',
            unit: '',
            noNegative: false,
            clamp: false,
            min: '',
            max: '',
        };
        return ensureTitle(item, t);
    }

    function stringifyCompact(value, maxLen = 70) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        let str;
        try {
            if (typeof value === 'string') {
                str = value;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                str = String(value);
            } else {
                str = JSON.stringify(value);
            }
        } catch {
            str = String(value);
        }
        str = String(str);
        if (str.length <= maxLen) return str;
        return str.slice(0, Math.max(0, maxLen - 1)) + '…';
    }

    function safeNumForPreview(v) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    // Keep in sync with adapter-side minimal JSONPath subset.
    // Supported examples:
    // - $.apower
    // - $.aenergy.by_minute[2]
    // - $['temperature']['tC']
    function applyJsonPathForPreview(obj, path) {
        if (!path) return undefined;
        let p = String(path).trim();
        if (!p) return undefined;

        // Accept both "$.x" and ".x" as a convenience.
        if (p.startsWith('.')) {
            p = `$${p}`;
        }
        if (!p.startsWith('$')) {
            return undefined;
        }

        let cur = obj;
        let i = 1; // skip '$'
        const len = p.length;
        const isDangerousKey = k => k === '__proto__' || k === 'prototype' || k === 'constructor';
        while (i < len) {
            const ch = p[i];
            if (ch === '.') {
                i++;
                const start = i;
                while (i < len && /[A-Za-z0-9_]/.test(p[i])) i++;
                const key = p.slice(start, i);
                if (!key) return undefined;
                if (isDangerousKey(key)) return undefined;
                if (cur === null || cur === undefined) return undefined;
                cur = cur[key];
                continue;
            }
            if (ch === '[') {
                i++;
                while (i < len && /\s/.test(p[i])) i++;
                if (i >= len) return undefined;
                const quote = p[i] === '"' || p[i] === "'" ? p[i] : null;
                if (quote) {
                    i++;
                    let str = '';
                    while (i < len) {
                        const c = p[i];
                        if (c === '\\') {
                            if (i + 1 < len) {
                                str += p[i + 1];
                                i += 2;
                                continue;
                            }
                            return undefined;
                        }
                        if (c === quote) {
                            i++;
                            break;
                        }
                        str += c;
                        i++;
                    }
                    while (i < len && /\s/.test(p[i])) i++;
                    if (p[i] !== ']') return undefined;
                    i++;
                    if (isDangerousKey(str)) return undefined;
                    if (cur === null || cur === undefined) return undefined;
                    cur = cur[str];
                    continue;
                }

                // array index
                const start = i;
                while (i < len && /[0-9]/.test(p[i])) i++;
                const numStr = p.slice(start, i);
                while (i < len && /\s/.test(p[i])) i++;
                if (p[i] !== ']') return undefined;
                i++;
                const idx = Number(numStr);
                if (!Number.isInteger(idx)) return undefined;
                if (!Array.isArray(cur)) return undefined;
                cur = cur[idx];
                continue;
            }

            // Unknown token
            return undefined;
        }
        return cur;
    }

    function getValueFromJsonPathForPreview(rawValue, jsonPath) {
        const jp = jsonPath !== undefined && jsonPath !== null ? String(jsonPath).trim() : '';
        if (!jp) {
            return rawValue;
        }

        let obj = null;
        if (rawValue && typeof rawValue === 'object') {
            obj = rawValue;
        } else if (typeof rawValue === 'string') {
            const s = rawValue.trim();
            if (!s) {
                return undefined;
            }
            try {
                obj = JSON.parse(s);
            } catch {
                return undefined;
            }
        } else {
            return undefined;
        }

        const extracted = applyJsonPathForPreview(obj, jp);
        if (extracted === undefined) {
            return undefined;
        }
        if (extracted === null) return null;
        const t = typeof extracted;
        if (t === 'string' || t === 'number' || t === 'boolean') return extracted;
        if (extracted instanceof Date && typeof extracted.toISOString === 'function') return extracted.toISOString();
        // Keep formulas deterministic: do not expose objects/arrays.
        return undefined;
    }

    function computePreviewInputValue(item, inp, rawValue) {
        const hasJsonPath = inp && inp.jsonPath !== undefined && inp.jsonPath !== null && String(inp.jsonPath).trim() !== '';
        let value;
        if (hasJsonPath) {
            const extracted = getValueFromJsonPathForPreview(rawValue, inp && inp.jsonPath);
            if (typeof extracted === 'string') {
                const n = Number(extracted);
                value = Number.isFinite(n) ? n : extracted;
            } else {
                value = extracted;
            }
        } else {
            value = safeNumForPreview(rawValue);
        }

        // Clamp negative inputs BEFORE formula evaluation (only if numeric).
        // Keep in sync with adapter behavior: item.noNegative is an OUTPUT rule.
        // Only per-input noNegative should clamp that specific source.
        if (typeof value === 'number' && (inp && inp.noNegative) && value < 0) {
            value = 0;
        }

        return value;
    }

    function isNumericOutputItemForPreview(item) {
        const t = item && item.type ? String(item.type) : '';
        return t === '' || t === 'number';
    }

    function applyResultRulesForPreview(item, value) {
        let v = safeNumForPreview(value);

        const toOptionalNumber = val => {
            if (val === undefined || val === null) return NaN;
            if (typeof val === 'string' && val.trim() === '') return NaN;
            const n = Number(val);
            return Number.isFinite(n) ? n : NaN;
        };

        if (item && item.noNegative && v < 0) {
            v = 0;
        }

        if (item && item.clamp) {
            const min = toOptionalNumber(item.min);
            const max = toOptionalNumber(item.max);
            if (Number.isFinite(min) && v < min) v = min;
            if (Number.isFinite(max) && v > max) v = max;
        }

        return v;
    }

    function sanitizeInputKey(raw) {
        const keyRaw = raw ? String(raw).trim() : '';
        const key = keyRaw.replace(/[^a-zA-Z0-9_]/g, '_');
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return '';
        return key;
    }

    function normalizeFormulaForPreview(expr) {
        // Keep in sync (loosely) with adapter-side normalization, but only for preview.
        // - AND/OR/NOT -> &&/||/! outside strings
        // - single '=' -> '==' outside strings
        let s = String(expr || '');
        let out = '';
        let inStr = null;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (inStr) {
                out += ch;
                if (ch === '\\') {
                    // skip escaped char
                    i++;
                    if (i < s.length) out += s[i];
                    continue;
                }
                if (ch === inStr) inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = ch;
                out += ch;
                continue;
            }
            out += ch;
        }

        // Replace logical words outside strings by splitting again.
        // This is conservative (word boundaries) and good enough for preview.
        inStr = null;
        let buf = '';
        for (let i = 0; i < out.length; i++) {
            const ch = out[i];
            if (inStr) {
                buf += ch;
                if (ch === '\\') {
                    i++;
                    if (i < out.length) buf += out[i];
                    continue;
                }
                if (ch === inStr) inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = ch;
                buf += ch;
                continue;
            }
            buf += ch;
        }

        let normalized = buf
            .replace(/\bAND\b/gi, '&&')
            .replace(/\bOR\b/gi, '||')
            .replace(/\bNOT\b/gi, '!');

        // Replace standalone '=' with '==' (skip >=, <=, ==, !=, =>)
        let eqOut = '';
        inStr = null;
        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            if (inStr) {
                eqOut += ch;
                if (ch === '\\') {
                    i++;
                    if (i < normalized.length) eqOut += normalized[i];
                    continue;
                }
                if (ch === inStr) inStr = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = ch;
                eqOut += ch;
                continue;
            }
            if (ch === '=') {
                const prev = i > 0 ? normalized[i - 1] : '';
                const next = i + 1 < normalized.length ? normalized[i + 1] : '';
                if (prev === '=' || prev === '!' || prev === '<' || prev === '>' || next === '=' || next === '>') {
                    eqOut += ch;
                } else {
                    eqOut += '==';
                }
                continue;
            }
            eqOut += ch;
        }

        return eqOut;
    }

    function evalPreviewExpression(expr, vars, t) {
        const T = text => {
            try {
                return t ? t(text) : text;
            } catch {
                return text;
            }
        };

        const src = normalizeFormulaForPreview(expr);

        // State functions can't be safely previewed in-browser.
        if (/\b(s|v|jp)\s*\(/.test(src)) {
            throw new Error(T('Preview not supported for state functions'));
        }

        let i = 0;
        const s = src;
        const tokens = [];

        const isSpace = c => c === ' ' || c === '\t' || c === '\n' || c === '\r';
        const isDigit = c => c >= '0' && c <= '9';
        const isIdStart = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
        const isId = c => isIdStart(c) || isDigit(c);

        const readString = quote => {
            i++; // skip quote
            let out = '';
            while (i < s.length) {
                const ch = s[i];
                if (ch === '\\') {
                    i++;
                    if (i >= s.length) break;
                    out += s[i];
                    i++;
                    continue;
                }
                if (ch === quote) {
                    i++;
                    return out;
                }
                out += ch;
                i++;
            }
            throw new Error(T('Unterminated string'));
        };

        const readNumber = () => {
            let start = i;
            while (i < s.length && isDigit(s[i])) i++;
            if (i < s.length && s[i] === '.') {
                i++;
                while (i < s.length && isDigit(s[i])) i++;
            }
            if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
                i++;
                if (i < s.length && (s[i] === '+' || s[i] === '-')) i++;
                while (i < s.length && isDigit(s[i])) i++;
            }
            const raw = s.slice(start, i);
            const n = Number(raw);
            if (!Number.isFinite(n)) throw new Error(T('Invalid number'));
            return n;
        };

        const readIdent = () => {
            let start = i;
            i++;
            while (i < s.length && isId(s[i])) i++;
            return s.slice(start, i);
        };

        const pushOp = op => tokens.push({ t: 'op', v: op });
        const pushPunc = p => tokens.push({ t: p, v: p });

        while (i < s.length) {
            const ch = s[i];
            if (isSpace(ch)) {
                i++;
                continue;
            }
            if (ch === '"' || ch === "'") {
                tokens.push({ t: 'str', v: readString(ch) });
                continue;
            }
            if (isDigit(ch) || (ch === '.' && i + 1 < s.length && isDigit(s[i + 1]))) {
                tokens.push({ t: 'num', v: readNumber() });
                continue;
            }
            if (isIdStart(ch)) {
                const id = readIdent();
                if (id === 'true') tokens.push({ t: 'bool', v: true });
                else if (id === 'false') tokens.push({ t: 'bool', v: false });
                else if (id === 'null') tokens.push({ t: 'null', v: null });
                else tokens.push({ t: 'id', v: id });
                continue;
            }
            // two-char ops
            const two = s.slice(i, i + 2);
            if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
                pushOp(two);
                i += 2;
                continue;
            }
            // single-char
            if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '!' || ch === '<' || ch === '>') {
                pushOp(ch);
                i++;
                continue;
            }
            if (ch === '(' || ch === ')' || ch === ',' || ch === '?' || ch === ':') {
                pushPunc(ch);
                i++;
                continue;
            }
            throw new Error(`${T('Unexpected character')}: ${ch}`);
        }
        tokens.push({ t: 'eof', v: '' });

        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];
        const expect = tt => {
            const tok = next();
            if (!tok || tok.t !== tt) throw new Error(`${T('Expected')} ${tt}`);
            return tok;
        };

        const fns = {
            min: (a, b) => Math.min(Number(a), Number(b)),
            max: (a, b) => Math.max(Number(a), Number(b)),
            clamp: (value, min, max) => Math.min(Math.max(Number(value), Number(min)), Number(max)),
            IF: (cond, vt, vf) => (cond ? vt : vf),
        };

        const lbp = op => {
            if (op === '||') return 10;
            if (op === '&&') return 20;
            if (op === '==' || op === '!=') return 30;
            if (op === '<' || op === '<=' || op === '>' || op === '>=') return 40;
            if (op === '+' || op === '-') return 50;
            if (op === '*' || op === '/' || op === '%') return 60;
            return 0;
        };

        const parsePrimary = () => {
            const tok = next();
            if (!tok) throw new Error(T('Unexpected end'));
            if (tok.t === 'num' || tok.t === 'str' || tok.t === 'bool' || tok.t === 'null') return tok.v;
            if (tok.t === 'id') {
                // function call?
                if (peek().t === '(') {
                    next();
                    const args = [];
                    if (peek().t !== ')') {
                        while (true) {
                            args.push(parseExpr(0));
                            if (peek().t === ',') {
                                next();
                                continue;
                            }
                            break;
                        }
                    }
                    expect(')');
                    const fn = fns[tok.v];
                    if (!fn) throw new Error(`${T('Unknown function')}: ${tok.v}`);
                    return fn.apply(null, args);
                }
                return vars && Object.prototype.hasOwnProperty.call(vars, tok.v) ? vars[tok.v] : undefined;
            }
            if (tok.t === '(') {
                const v = parseExpr(0);
                expect(')');
                return v;
            }
            if (tok.t === 'op' && (tok.v === '+' || tok.v === '-' || tok.v === '!')) {
                const v = parseExpr(70);
                if (tok.v === '+') return Number(v);
                if (tok.v === '-') return -Number(v);
                return !v;
            }
            throw new Error(`${T('Unexpected token')}: ${tok.t}`);
        };

        const applyOp = (op, a, b) => {
            switch (op) {
                case '+':
                    return Number(a) + Number(b);
                case '-':
                    return Number(a) - Number(b);
                case '*':
                    return Number(a) * Number(b);
                case '/':
                    return Number(a) / Number(b);
                case '%':
                    return Number(a) % Number(b);
                case '==':
                    // eslint-disable-next-line eqeqeq
                    return a == b;
                case '!=':
                    // eslint-disable-next-line eqeqeq
                    return a != b;
                case '<':
                    return a < b;
                case '<=':
                    return a <= b;
                case '>':
                    return a > b;
                case '>=':
                    return a >= b;
                case '&&':
                    return a && b;
                case '||':
                    return a || b;
                default:
                    throw new Error(`${T('Unsupported operator')}: ${op}`);
            }
        };

        const parseExpr = minBp => {
            let left = parsePrimary();
            while (true) {
                const tok = peek();
                if (!tok) break;
                if (tok.t === '?') {
                    if (minBp > 5) break;
                    next();
                    const tVal = parseExpr(0);
                    expect(':');
                    const fVal = parseExpr(0);
                    left = left ? tVal : fVal;
                    continue;
                }
                if (tok.t !== 'op') break;
                const bp = lbp(tok.v);
                if (bp < minBp) break;
                next();
                const right = parseExpr(bp + 1);
                left = applyOp(tok.v, left, right);
            }
            return left;
        };

        const value = parseExpr(0);
        if (peek().t !== 'eof') {
            throw new Error(T('Unexpected token'));
        }
        return value;
    }

    function createDataSolectrusItemsEditor(React, AdapterReact) {
        return function DataSolectrusItemsEditor(props) {
            const DEFAULT_ITEMS_ATTR = 'dsItems';
            const attr = (props && typeof props.attr === 'string' && props.attr) ? props.attr : DEFAULT_ITEMS_ATTR;
            const dataIsArray = Array.isArray(props && props.data);
            const dataIsObject = !!(props && props.data && typeof props.data === 'object' && !dataIsArray);

            const getDomThemeType = () => {
                try {
                    const doc = globalThis.document;
                    const root = doc && doc.documentElement ? doc.documentElement : null;

                    const rootAttrTheme = root ? root.getAttribute('data-theme') : '';
                    if (rootAttrTheme === 'dark' || rootAttrTheme === 'light') return rootAttrTheme;

                    // MUI v5 color scheme (some Admin versions)
                    const muiScheme = root ? root.getAttribute('data-mui-color-scheme') : '';
                    if (muiScheme === 'dark' || muiScheme === 'light') return muiScheme;

                    const colorScheme = root ? root.getAttribute('data-color-scheme') : '';
                    if (colorScheme === 'dark' || colorScheme === 'light') return colorScheme;

                    const body = doc ? doc.body : null;
                    if (body && body.classList) {
                        if (body.classList.contains('mui-theme-dark') || body.classList.contains('iob-theme-dark')) {
                            return 'dark';
                        }
                        if (body.classList.contains('mui-theme-light') || body.classList.contains('iob-theme-light')) {
                            return 'light';
                        }
                    }

                    if (root && root.classList) {
                        if (root.classList.contains('mui-theme-dark') || root.classList.contains('iob-theme-dark')) return 'dark';
                        if (root.classList.contains('mui-theme-light') || root.classList.contains('iob-theme-light')) return 'light';
                    }
                } catch {
                    // ignore
                }
                return '';
            };

            const getThemeType = () => {
                // DOM is the source of truth for the currently active Admin theme.
                // Some Admin theme switches do not trigger a re-render of custom components.
                const domTheme = getDomThemeType();
                if (domTheme === 'dark' || domTheme === 'light') {
                    return domTheme;
                }

                // Some Admin versions switch theme by swapping CSS variables / styles only,
                // without changing attributes/classes we can observe. Infer mode from computed colors.
                const getComputedThemeType = () => {
                    try {
                        const doc = globalThis.document;
                        if (!doc || !globalThis.getComputedStyle) return '';

                        const parseRgb = value => {
                            const s = String(value || '').trim();
                            const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
                            if (!m) return null;
                            const r = Number(m[1]);
                            const g = Number(m[2]);
                            const b = Number(m[3]);
                            const a = m[4] === undefined ? 1 : Number(m[4]);
                            if (![r, g, b, a].every(n => Number.isFinite(n))) return null;
                            return { r, g, b, a };
                        };

                        const luminance = rgb => {
                            // Simple perceived luminance (0..255)
                            return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
                        };

                        const candidates = [];
                        if (doc.body) candidates.push(doc.body);
                        if (doc.documentElement) candidates.push(doc.documentElement);
                        try {
                            const q = sel => doc.querySelector(sel);
                            candidates.push(
                                q('.MuiPaper-root'),
                                q('.MuiDrawer-paper'),
                                q('.MuiDialog-paper'),
                                q('#root'),
                                q('.root')
                            );
                        } catch {
                            // ignore
                        }

                        for (let i = 0; i < candidates.length; i++) {
                            const el = candidates[i];
                            if (!el) continue;
                            const cs = globalThis.getComputedStyle(el);
                            if (!cs) continue;
                            const bg = parseRgb(cs.backgroundColor);
                            if (!bg) continue;
                            if (bg.a === 0) continue; // transparent
                            const l = luminance(bg);
                            // Threshold chosen to be robust; typical dark backgrounds are well below this.
                            return l < 140 ? 'dark' : 'light';
                        }
                    } catch {
                        // ignore
                    }
                    return '';
                };

                const computedTheme = getComputedThemeType();
                if (computedTheme === 'dark' || computedTheme === 'light') {
                    return computedTheme;
                }

                if (props && typeof props.themeType === 'string' && (props.themeType === 'dark' || props.themeType === 'light')) {
                    return props.themeType;
                }

                const mode = props && props.theme && props.theme.palette && props.theme.palette.mode;
                if (mode === 'dark' || mode === 'light') {
                    return mode;
                }

                return '';
            };

            const [themeType, setThemeType] = React.useState(() => getThemeType());

            React.useEffect(() => {
                let observer;
                let interval;
                let media;

                const update = () => {
                    const next = getThemeType();
                    if (next === 'dark' || next === 'light') {
                        setThemeType(prev => (prev === next ? prev : next));
                    }
                };

                // Sync once on mount.
                update();

                // Best-effort: detect theme changes without relying on custom component re-render.
                try {
                    const doc = globalThis.document;
                    if (doc && typeof globalThis.MutationObserver === 'function') {
                        observer = new globalThis.MutationObserver(update);

                        // Observe root/body + body subtree for attribute-based theme markers.
                        const attributeFilter = ['data-theme', 'data-mui-color-scheme', 'data-color-scheme', 'class'];
                        if (doc.documentElement) {
                            observer.observe(doc.documentElement, { attributes: true, attributeFilter });
                        }
                        if (doc.body) {
                            observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
                            observer.observe(doc.body, { attributes: true, subtree: true, attributeFilter });
                        }
                    }
                } catch {
                    // ignore
                }

                // Fallback: periodic check (cheap) for Admin versions that don't mutate attributes we track.
                try {
                    interval = globalThis.setInterval(update, 500);
                } catch {
                    // ignore
                }

                // Browser/OS theme changes.
                try {
                    if (globalThis.matchMedia) {
                        media = globalThis.matchMedia('(prefers-color-scheme: dark)');
                        if (media && typeof media.addEventListener === 'function') {
                            media.addEventListener('change', update);
                        } else if (media && typeof media.addListener === 'function') {
                            media.addListener(update);
                        }
                    }
                } catch {
                    // ignore
                }

                return () => {
                    try {
                        observer && observer.disconnect();
                    } catch {
                        // ignore
                    }
                    try {
                        interval && globalThis.clearInterval(interval);
                    } catch {
                        // ignore
                    }
                    try {
                        if (media && typeof media.removeEventListener === 'function') {
                            media.removeEventListener('change', update);
                        } else if (media && typeof media.removeListener === 'function') {
                            media.removeListener(update);
                        }
                    } catch {
                        // ignore
                    }
                };
            }, []);

            const isDark = themeType === 'dark';
            const theme = (props && props.theme) || null;
            const themePalette = theme && theme.palette ? theme.palette : null;
            const paletteMatches = !!(themePalette && (themePalette.mode === 'dark' || themePalette.mode === 'light') && themePalette.mode === themeType);
            const effectivePalette = paletteMatches ? themePalette : null;

            const fallbackColors = isDark
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

            // Prefer the surrounding Admin theme to keep this editor visually consistent.
            // Fallback to the self-defined palette if theme is unavailable.
            const colors = Object.assign({}, fallbackColors, {
                panelBg: (effectivePalette && effectivePalette.background && effectivePalette.background.paper) || fallbackColors.panelBg,
                panelBg2:
                    (effectivePalette && effectivePalette.background && (effectivePalette.background.paper || effectivePalette.background.default)) ||
                    fallbackColors.panelBg2,
                text: (effectivePalette && effectivePalette.text && effectivePalette.text.primary) || fallbackColors.text,
                textMuted: (effectivePalette && effectivePalette.text && effectivePalette.text.secondary) || fallbackColors.textMuted,
                border: (effectivePalette && effectivePalette.divider) || fallbackColors.border,
                rowBorder: (effectivePalette && effectivePalette.divider) || fallbackColors.rowBorder,
                hover: (effectivePalette && effectivePalette.action && effectivePalette.action.hover) || fallbackColors.hover,
                active: (effectivePalette && effectivePalette.action && effectivePalette.action.selected) || fallbackColors.active,
                inputBg:
                    (effectivePalette && effectivePalette.background && effectivePalette.background.paper) ||
                    (isDark ? 'rgba(255,255,255,0.06)' : '#ffffff'),
            });

            const DialogSelectID = AdapterReact && (AdapterReact.DialogSelectID || AdapterReact.SelectID);
            const socket = (props && props.socket) || globalThis.socket || globalThis._socket || null;

            const t = text => {
                try {
                    if (props && typeof props.t === 'function') {
                        return props.t(text);
                    }
                } catch {
                    // ignore
                }

                const I18n =
                    (AdapterReact && AdapterReact.I18n) ||
                    globalThis.I18n ||
                    (globalThis.window && globalThis.window.I18n);

                try {
                    if (I18n && typeof I18n.t === 'function') {
                        return I18n.t(text);
                    }
                    if (I18n && typeof I18n.getTranslation === 'function') {
                        return I18n.getTranslation(text);
                    }
                } catch {
                    // ignore
                }

                return text;
            };

            const items = dataIsArray
                ? normalizeItems(props.data)
                : normalizeItems(
                      (props.data && props.data[DEFAULT_ITEMS_ATTR]) ||
                          (props.data && props.data[attr]) ||
                          (props.data && props.data.itemsEditor)
                  );

            const [selectedIndex, setSelectedIndex] = React.useState(0);
            const [selectContext, setSelectContext] = React.useState(null);
            const [openDropdown, setOpenDropdown] = React.useState(null);
            const [collapsedFolders, setCollapsedFolders] = React.useState({});

			const [formulaBuilderOpen, setFormulaBuilderOpen] = React.useState(false);
			const [formulaDraft, setFormulaDraft] = React.useState('');
			const formulaEditorRef = React.useRef(null);
            const [formulaLiveValues, setFormulaLiveValues] = React.useState({});
            const [formulaLiveTs, setFormulaLiveTs] = React.useState({});
            const [formulaLivePollNonce, setFormulaLivePollNonce] = React.useState(0);
            const [formulaLiveLoading, setFormulaLiveLoading] = React.useState(false);
            const [formulaPreview, setFormulaPreview] = React.useState(null);
            const [formulaPreviewLoading, setFormulaPreviewLoading] = React.useState(false);

            React.useEffect(() => {
                const onDocMouseDown = e => {
                    if (!openDropdown) return;
                    try {
                        const target = e && e.target;
                        if (target && target.closest && target.closest('[data-ds-dropdown="1"]')) {
                            return;
                        }
                    } catch {
                        // ignore
                    }
                    setOpenDropdown(null);
                };

                try {
                    globalThis.document && globalThis.document.addEventListener('mousedown', onDocMouseDown);
                } catch {
                    // ignore
                }

                return () => {
                    try {
                        globalThis.document && globalThis.document.removeEventListener('mousedown', onDocMouseDown);
                    } catch {
                        // ignore
                    }
                };
            }, [openDropdown]);

            React.useEffect(() => {
                if (selectedIndex > items.length - 1) {
                    setSelectedIndex(Math.max(0, items.length - 1));
                }
            }, [items.length, selectedIndex]);

            React.useEffect(() => {
                if (!formulaBuilderOpen) return;
                const onKeyDown = e => {
                    if (e && e.key === 'Escape') {
                        setFormulaBuilderOpen(false);
                    }
                };
                try {
                    globalThis.document && globalThis.document.addEventListener('keydown', onKeyDown);
                } catch {
                    // ignore
                }
                return () => {
                    try {
                        globalThis.document && globalThis.document.removeEventListener('keydown', onKeyDown);
                    } catch {
                        // ignore
                    }
                };
            }, [formulaBuilderOpen]);

            const setByPath = (rootObj, path, value) => {
                if (!path) {
                    return value;
                }

                const parts = String(path).split('.').filter(Boolean);
                const clonedRoot = Array.isArray(rootObj)
                    ? rootObj.slice()
                    : Object.assign({}, rootObj || {});
                let cursor = clonedRoot;

                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    const isArrayIndex = Array.isArray(cursor) && /^\d+$/.test(part);
                    const key = isArrayIndex ? parseInt(part, 10) : part;
                    const existing = cursor[key];

                    const next = Array.isArray(existing)
                        ? existing.slice()
                        : existing && typeof existing === 'object'
                          ? Object.assign({}, existing)
                          : {};

                    cursor[key] = next;
                    cursor = next;
                }

                const last = parts[parts.length - 1];
                const lastKey = Array.isArray(cursor) && /^\d+$/.test(last) ? parseInt(last, 10) : last;
                cursor[lastKey] = value;

                return clonedRoot;
            };

            const updateItems = nextItems => {
                if (typeof props.onChange !== 'function') {
                    return;
                }

                const onChange = props.onChange;
                const cb = () => {
                    try {
                        if (props && typeof props.forceUpdate === 'function') {
                            props.forceUpdate([attr], props.data);
                        }
                    } catch {
                        // ignore
                    }
                };

                const safeItems = normalizeItems(nextItems).map(it => ensureTitle(it, t));

                if (props && props.custom) {
                    // Some Admin versions do NOT allow passing `attr` in jsonConfig for custom controls.
                    // So we always write to native.items, regardless of the schema field name.
                    try {
                        onChange(DEFAULT_ITEMS_ATTR, safeItems);
                    } catch {
                        // ignore
                    }
                    // Best-effort: also update the field that hosts this custom control to keep the UI in sync.
                    if (attr !== DEFAULT_ITEMS_ATTR) {
                        try {
                            onChange(attr, safeItems);
                        } catch {
                            // ignore
                        }
                    }
                    return;
                }

                if (dataIsObject) {
                    const nextData = setByPath(props.data, attr, safeItems);
                    onChange(nextData);
                    cb();
                    return;
                }

                onChange(safeItems);
            };

            const selectedItem = items[selectedIndex] || null;

            // Group items by their group/folder field
            const groupedItems = React.useMemo(() => {
                const groups = {};
                items.forEach((item, index) => {
                    const groupName = (item.group || '').trim() || t('Ungrouped');
                    if (!groups[groupName]) {
                        groups[groupName] = [];
                    }
                    groups[groupName].push({ item, index });
                });
                return groups;
            }, [items, t]);

            const toggleFolder = folderName => {
                setCollapsedFolders(prev => ({
                    ...prev,
                    [folderName]: !prev[folderName],
                }));
            };

            const formulaInputSignature = (() => {
                if (!formulaBuilderOpen || !selectedItem) return '';
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs : [];
                return inputs.map(inp => (inp && inp.sourceState ? String(inp.sourceState) : '')).filter(Boolean).join('|');
            })();

            const formulaLiveSignature = (() => {
                if (!formulaBuilderOpen || !selectedItem) return '';
                const ids = formulaInputSignature ? String(formulaInputSignature).split('|').filter(Boolean) : [];
                const parts = ids.map(id => {
                    const ts = formulaLiveTs && Object.prototype.hasOwnProperty.call(formulaLiveTs, id) ? formulaLiveTs[id] : undefined;
                    const val = formulaLiveValues && Object.prototype.hasOwnProperty.call(formulaLiveValues, id) ? formulaLiveValues[id] : undefined;
                    return `${id}:${ts === undefined ? '' : String(ts)}:${stringifyCompact(val, 30)}`;
                });
                parts.push(`_poll:${String(formulaLivePollNonce || 0)}`);
                return parts.join('|');
            })();

            const getAdapterInstanceId = () => {
                const adapterName = (props && (props.adapterName || props.adapter)) || 'data-solectrus';
                const instanceId = props && typeof props.instanceId === 'string' ? props.instanceId : '';
                if (instanceId && String(instanceId).startsWith('system.adapter.')) return String(instanceId);
                if (instanceId && /^[a-zA-Z0-9_-]+\.\d+$/.test(String(instanceId))) return String(instanceId);
                const inst = props && Number.isFinite(props.instance) ? props.instance : 0;
                return `${adapterName}.${inst}`;
            };

            const getAdapterSendToTargets = () => {
                const base = getAdapterInstanceId();
                if (!base) return [];
                if (String(base).startsWith('system.adapter.')) {
                    const short = String(base).slice('system.adapter.'.length);
                    return [String(base), short].filter(Boolean);
                }
                return [String(base), `system.adapter.${String(base)}`];
            };

            const getAdapterAliveId = () => {
                const base = getAdapterInstanceId();
                if (!base) return '';
                return String(base).startsWith('system.adapter.') ? `${base}.alive` : `system.adapter.${base}.alive`;
            };

            const openFormulaBuilder = () => {
                if (!selectedItem) return;
                setFormulaDraft(String(selectedItem.formula || ''));
                setFormulaBuilderOpen(true);
                try {
                    globalThis.requestAnimationFrame(() => {
                        const el = formulaEditorRef.current;
                        if (el && typeof el.focus === 'function') {
                            el.focus();
                        }
                    });
                } catch {
                    // ignore
                }
            };

            const refreshFormulaLiveValues = async opts => {
                const reason = opts && opts.reason ? String(opts.reason) : '';
                if (!formulaBuilderOpen) return;
                if (!selectedItem) return;
                if (!socket || typeof socket.getState !== 'function') return;

                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs : [];
                const ids = inputs
                    .map(inp => (inp && inp.sourceState ? String(inp.sourceState) : ''))
                    .filter(Boolean);
                const uniqueIds = Array.from(new Set(ids));
                if (!uniqueIds.length) {
                    setFormulaLiveValues({});
                    setFormulaLiveTs({});
                    setFormulaLivePollNonce(n => n + 1);
                    return;
                }

                setFormulaLiveLoading(true);
                try {
                    const results = await Promise.all(
                        uniqueIds.map(async id => {
                            try {
                                const st = await socket.getState(id);
                                return { id, st: st || null };
                            } catch {
                                return { id, st: null };
                            }
                        })
                    );
                    const nextVals = {};
                    const nextTs = {};
                    for (const r of results) {
                        nextVals[r.id] = r.st ? r.st.val : undefined;
                        nextTs[r.id] = r.st && typeof r.st.ts === 'number' ? r.st.ts : undefined;
                    }
                    setFormulaLiveValues(nextVals);
                    setFormulaLiveTs(nextTs);
                    setFormulaLivePollNonce(n => n + 1);
                    if (reason && props && props.onDebug) {
                        try {
                            props.onDebug('formulaLiveValues', { reason, count: uniqueIds.length });
                        } catch {
                            // ignore
                        }
                    }
                } finally {
                    setFormulaLiveLoading(false);
                }
            };

            const refreshFormulaPreview = async opts => {
                const reason = opts && opts.reason ? String(opts.reason) : '';
                const showLoading = !!(opts && opts.showLoading);
                if (!formulaBuilderOpen) return;
                if (!selectedItem) return;

                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs : [];
                const vars = Object.create(null);
                for (const inp of inputs) {
                    const key = sanitizeInputKey(inp && inp.key ? inp.key : '');
                    if (!key) continue;
                    const id = inp && inp.sourceState ? String(inp.sourceState) : '';
                    const raw = id ? formulaLiveValues[id] : undefined;
                    vars[key] = computePreviewInputValue(selectedItem, inp, raw);
                }

                if (showLoading) {
                    setFormulaPreviewLoading(true);
                }
                try {
                    const val = evalPreviewExpression(String(formulaDraft || ''), vars, t);
                    const previewValue = isNumericOutputItemForPreview(selectedItem)
                        ? applyResultRulesForPreview(selectedItem, val)
                        : val;
                    setFormulaPreview({ ok: true, value: previewValue });
                    if (reason && props && props.onDebug) {
                        try {
                            props.onDebug('formulaPreview', { reason, ok: true });
                        } catch {
                            // ignore
                        }
                    }
                } catch (e) {
                    const err = e && e.message ? String(e.message) : String(e);
                    setFormulaPreview({ ok: false, error: err });
                } finally {
                    if (showLoading) {
                        setFormulaPreviewLoading(false);
                    }
                }
            };

            React.useEffect(() => {
                if (!formulaBuilderOpen) return;
                let timer = null;
                try {
                    timer = setTimeout(() => {
                        refreshFormulaPreview({ reason: 'debounced' });
                    }, 250);
                } catch {
                    // ignore
                }
                return () => {
                    if (timer) {
                        try {
                            clearTimeout(timer);
                        } catch {
                            // ignore
                        }
                    }
                };
            }, [formulaBuilderOpen, formulaDraft, formulaLiveSignature]);

            React.useEffect(() => {
                if (!formulaBuilderOpen) return;
                let alive = true;
                let timer = null;

                const run = async () => {
                    if (!alive) return;
                    await refreshFormulaLiveValues({ reason: 'auto' });
                };

                run();
                try {
                    timer = setInterval(() => {
                        run();
                    }, 2000);
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
            }, [formulaBuilderOpen, selectedIndex, formulaInputSignature]);

            const insertIntoFormulaDraft = opts => {
                const text = opts && opts.text !== undefined ? String(opts.text) : '';
                const el = formulaEditorRef.current;
                const curValue = String(formulaDraft || '');
                const selStart = el && typeof el.selectionStart === 'number' ? el.selectionStart : curValue.length;
                const selEnd = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : curValue.length;
                const before = curValue.slice(0, selStart);
                const after = curValue.slice(selEnd);
                const next = before + text + after;

                const startWithin = opts && typeof opts.selectStartWithinText === 'number' ? opts.selectStartWithinText : text.length;
                const endWithin = opts && typeof opts.selectEndWithinText === 'number' ? opts.selectEndWithinText : text.length;
                const nextSelStart = selStart + Math.max(0, startWithin);
                const nextSelEnd = selStart + Math.max(0, endWithin);

                setFormulaDraft(next);
                try {
                    globalThis.requestAnimationFrame(() => {
                        const el2 = formulaEditorRef.current;
                        if (!el2 || typeof el2.focus !== 'function') return;
                        el2.focus();
                        try {
                            el2.setSelectionRange(nextSelStart, nextSelEnd);
                        } catch {
                            // ignore
                        }
                    });
                } catch {
                    // ignore
                }
            };

            const updateSelected = (field, value) => {
                const nextItems = items.map((it, i) => {
                    if (i !== selectedIndex) return it;
                    const next = Object.assign({}, it || {});
                    next[field] = value;
                    return ensureTitle(next, t);
                });
                updateItems(nextItems);
            };

            const moveSelected = direction => {
                const from = selectedIndex;
                const to = from + direction;
                if (to < 0 || to >= items.length) return;

                const nextItems = items.slice();
                const tmp = nextItems[from];
                nextItems[from] = nextItems[to];
                nextItems[to] = tmp;

                updateItems(nextItems);
                setSelectedIndex(to);
            };

            const addItem = () => {
                const nextItems = items.concat([makeNewItem(t)]);
                updateItems(nextItems);
                setSelectedIndex(nextItems.length - 1);
            };

            const cloneSelected = () => {
                if (!selectedItem) return;
                const clone = ensureTitle(Object.assign({}, selectedItem), t);
                const nextItems = items.slice();
                nextItems.splice(selectedIndex + 1, 0, clone);
                updateItems(nextItems);
                setSelectedIndex(selectedIndex + 1);
            };

            const deleteSelected = () => {
                if (!selectedItem) return;
                const nextItems = items.slice();
                nextItems.splice(selectedIndex, 1);
                updateItems(nextItems);
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            };

            const updateInput = (index, field, value) => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
                const cur = inputs[index] && typeof inputs[index] === 'object' ? Object.assign({}, inputs[index]) : {};
                cur[field] = value;
                inputs[index] = cur;
                updateSelected('inputs', inputs);
            };

            const addInput = () => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
				inputs.push({ key: '', sourceState: '', jsonPath: '', noNegative: false });
                updateSelected('inputs', inputs);
            };

            const deleteInput = index => {
                if (!selectedItem) return;
                const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs.slice() : [];
                inputs.splice(index, 1);
                updateSelected('inputs', inputs);
            };

            const rootStyle = {
                display: 'flex',
                gap: 12,
                width: '100%',
                minHeight: 360,
                height: '70vh',
                color: colors.text,
                position: 'relative',
                alignItems: 'stretch',
            };

            const leftStyle = {
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

            const rightStyle = {
                flex: 1,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 12,
                background: colors.panelBg2,
                height: '100%',
                overflow: 'auto',
            };

            const toolbarStyle = {
                display: 'flex',
                gap: 8,
                padding: 10,
                borderBottom: `1px solid ${colors.rowBorder}`,
                flexWrap: 'wrap',
            };

            const listStyle = {
                overflowY: 'auto',
                overflowX: 'hidden',
                flex: 1,
            };

            const btnStyle = {
                padding: '6px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: 'transparent',
                cursor: 'pointer',
                color: colors.text,
            };

            const btnDangerStyle = Object.assign({}, btnStyle, {
                border: `1px solid ${isDark ? 'rgba(255,120,120,0.5)' : 'rgba(200,0,0,0.25)'}`,
            });

            const listBtnStyle = isActive => ({
                width: '100%',
                textAlign: 'left',
                padding: '10px 10px',
                border: 'none',
                borderBottom: `1px solid ${colors.rowBorder}`,
                background: isActive ? colors.active : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                overflow: 'hidden',
                color: colors.text,
            });

            const folderBtnStyle = {
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

            const folderItemStyle = {
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

            const folderItemActiveStyle = Object.assign({}, folderItemStyle, {
                background: colors.active,
            });

            const labelStyle = { display: 'block', fontSize: 12, color: colors.textMuted, marginTop: 10 };
            const inputStyle = {
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                fontFamily: 'inherit',
                fontSize: 14,
                color: colors.text,
                background: colors.inputBg,
            };

            // Chrome/OS dropdowns may render <option> on a light surface even in dark mode,
            // but inherit the white text color -> white on white. Force readable option styling.
            const selectStyle = Object.assign({}, inputStyle, {
                backgroundColor: colors.panelBg,
                color: colors.text,
                colorScheme: isDark ? 'dark' : 'light',
                WebkitTextFillColor: colors.text,
            });

            const optionStyle = {
                background: colors.panelBg,
                color: colors.text,
            };

            // Native <select>/<option> popups can ignore styles in Chrome dark mode (OS-rendered).
            // Use a custom dropdown to ensure readable options.
            // Match the visual style of normal inputs in this editor.
            // In dark mode, inputStyle.background is slightly transparent (rgba). For dropdown menus
            // that looks wrong because the page background shines through. Use an opaque panel color.
            const bgStr = String(inputStyle.background || '');
            const isTranslucent = isDark && bgStr.startsWith('rgba(');
            const dropdownBg = isTranslucent ? colors.panelBg : inputStyle.background;
            const dropdownText = colors.text;

            const dropdownButtonStyle = Object.assign({}, inputStyle, {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: dropdownBg,
                color: dropdownText,
                cursor: 'pointer',
                userSelect: 'none',
            });

            const dropdownMenuStyle = {
                position: 'absolute',
                zIndex: 2000,
                left: 0,
                right: 0,
                marginTop: 6,
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: dropdownBg,
                color: dropdownText,
                boxShadow: isDark ? '0 10px 30px rgba(0,0,0,0.45)' : '0 10px 30px rgba(0,0,0,0.18)',
                maxHeight: 260,
                overflowY: 'auto',
                padding: 6,
            };

            const dropdownItemStyle = isActive => ({
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isActive ? colors.active : 'transparent',
                color: dropdownText,
            });

            const rowStyle2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

            const headerBarStyle = {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                marginBottom: 12,
            };

            const logoUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(HEADER_LOGO_SVG);

            const renderSelectButton = onClick =>
                React.createElement(
                    'button',
                    {
                        type: 'button',
                        style: Object.assign({}, btnStyle, { padding: '8px 10px' }),
                        disabled: !(DialogSelectID && socket && theme),
                        title: DialogSelectID && socket && theme ? t('Select from existing states') : t('Selection dialog not available'),
                        onClick,
                    },
                    t('Select')
                );

            const renderStatePicker = () => {
                if (!selectContext || !(DialogSelectID && socket && theme)) return null;

                const selected = (() => {
                    if (!selectedItem) return '';
                    if (selectContext.kind === 'itemSource') {
                        return selectedItem.sourceState || '';
                    }
                    if (selectContext.kind === 'input' && Number.isFinite(selectContext.index)) {
                        const inputs = Array.isArray(selectedItem.inputs) ? selectedItem.inputs : [];
                        const inp = inputs[selectContext.index];
                        return inp && inp.sourceState ? inp.sourceState : '';
                    }
					if (selectContext.kind === 'formulaFn') {
						return '';
					}
                    return '';
                })();

                return React.createElement(DialogSelectID, {
                    key: 'selectStateId',
                    imagePrefix: '../..',
                    dialogName: (props && (props.adapterName || props.adapter)) || 'data-solectrus',
                    themeType: themeType,
                    theme: theme,
                    socket: socket,
                    types: 'state',
                    selected: selected,
                    onClose: () => setSelectContext(null),
                    onOk: sel => {
                        const selectedStr = Array.isArray(sel) ? sel[0] : sel;
                        setSelectContext(null);
                        if (!selectedStr) return;
                        if (selectContext.kind === 'itemSource') {
                            updateSelected('sourceState', selectedStr);
                        }
                        if (selectContext.kind === 'input' && Number.isFinite(selectContext.index)) {
                            updateInput(selectContext.index, 'sourceState', selectedStr);
                        }
                        if (selectContext.kind === 'formulaFn') {
                            const fn = selectContext.fn;
                            if (fn === 's') {
                                insertIntoFormulaDraft({ text: `s("${selectedStr}")`, selectStartWithinText: (`s("`).length + String(selectedStr).length + 2, selectEndWithinText: (`s("`).length + String(selectedStr).length + 2 });
                                return;
                            }
                            if (fn === 'v') {
                                insertIntoFormulaDraft({ text: `v("${selectedStr}")`, selectStartWithinText: (`v("`).length + String(selectedStr).length + 2, selectEndWithinText: (`v("`).length + String(selectedStr).length + 2 });
                                return;
                            }
                            if (fn === 'jp') {
                                const txt = `jp("${selectedStr}", "$.value")`;
                                const start = txt.indexOf('$.value');
                                insertIntoFormulaDraft({ text: txt, selectStartWithinText: start, selectEndWithinText: start + '$.value'.length });
                                return;
                            }
                        }
                    },
                });
            };

            const renderFormulaBuilderModal = () => {
                if (!formulaBuilderOpen || !selectedItem) return null;

                const overlayStyle = {
                    position: 'fixed',
                    inset: 0,
                    background: isDark ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.35)',
                    zIndex: 5000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                };

                const modalStyle = {
                    width: 'min(1100px, 92vw)',
                    height: 'min(780px, 88vh)',
                    borderRadius: 12,
                    border: `1px solid ${colors.border}`,
                    background: colors.panelBg,
                    boxShadow: isDark ? '0 18px 50px rgba(0,0,0,0.55)' : '0 18px 50px rgba(0,0,0,0.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                };

                const modalHeaderStyle = {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 12px',
                    borderBottom: `1px solid ${colors.rowBorder}`,
                    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                };

                const modalBodyStyle = {
                    flex: 1,
                    display: 'flex',
                    minHeight: 0,
                };

                const modalLeftStyle = {
                    width: 320,
                    maxWidth: '44%',
                    borderRight: `1px solid ${colors.rowBorder}`,
                    padding: 12,
                    overflow: 'auto',
                    background: colors.panelBg2,
                };

                const modalRightStyle = {
                    flex: 1,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    minWidth: 0,
                };

                const sectionTitleStyle = {
                    fontSize: 12,
                    fontWeight: 600,
                    color: colors.text,
                    marginTop: 10,
                    marginBottom: 6,
                };

                const chipBtnStyle = {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 999,
                    border: `1px solid ${colors.border}`,
                    background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
                    cursor: 'pointer',
                    color: colors.text,
                    fontFamily: 'inherit',
                    fontSize: 13,
                };

                const chipBtnDisabledStyle = Object.assign({}, chipBtnStyle, {
                    opacity: 0.45,
                    cursor: 'not-allowed',
                });

                const valuePillStyle = {
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 8px',
                    borderRadius: 999,
                    border: `1px solid ${colors.border}`,
                    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    color: colors.textMuted,
                    fontSize: 12,
                    maxWidth: '100%',
                };

                const previewOkPillStyle = Object.assign({}, valuePillStyle, {
                    color: colors.text,
                    background: isDark ? 'rgba(46, 204, 113, 0.12)' : 'rgba(46, 204, 113, 0.10)',
                    border: `1px solid ${isDark ? 'rgba(46, 204, 113, 0.35)' : 'rgba(46, 204, 113, 0.25)'}`,
                });

                const previewErrPillStyle = Object.assign({}, valuePillStyle, {
                    color: colors.text,
                    background: isDark ? 'rgba(231, 76, 60, 0.12)' : 'rgba(231, 76, 60, 0.10)',
                    border: `1px solid ${isDark ? 'rgba(231, 76, 60, 0.35)' : 'rgba(231, 76, 60, 0.25)'}`,
                });

                const vars = Array.isArray(selectedItem.inputs)
                    ? selectedItem.inputs
                        .map(inp => {
                            const rawKey = inp && inp.key ? String(inp.key) : '';
                            const key = sanitizeInputKey(rawKey);
                            return {
                                rawKey,
                                key,
                                sourceState: inp && inp.sourceState ? String(inp.sourceState) : '',
                                jsonPath: inp && inp.jsonPath ? String(inp.jsonPath) : '',
                                noNegative: !!(inp && inp.noNegative),
                            };
                        })
                        .filter(v => !!v.key)
                    : [];

                const close = () => setFormulaBuilderOpen(false);
                const apply = () => {
                    updateSelected('formula', String(formulaDraft || ''));
                    setFormulaBuilderOpen(false);
                };

                const onOverlayMouseDown = e => {
                    if (e && e.target === e.currentTarget) {
                        close();
                    }
                };

                return React.createElement(
                    'div',
                    { style: overlayStyle, onMouseDown: onOverlayMouseDown },
                    React.createElement(
                        'div',
                        { style: modalStyle },
                        React.createElement(
                            'div',
                            { style: modalHeaderStyle },
                            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                                React.createElement('div', { style: { fontSize: 14, fontWeight: 700 } }, t('Formula Builder')),
                                React.createElement('div', { style: { fontSize: 12, color: colors.textMuted } }, t('Insert building blocks on the left. The editor uses current (unsaved) inputs.'))
                            ),
                            React.createElement(
                                'button',
                                { type: 'button', style: btnStyle, onClick: close, title: t('Close') },
                                t('Close')
                            )
                        ),
                        React.createElement(
                            'div',
                            { style: modalBodyStyle },
                            React.createElement(
                                'div',
                                { style: modalLeftStyle },
                                React.createElement('div', { style: sectionTitleStyle }, t('Variables (Inputs)')),
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 } },
                                    React.createElement('div', { style: { fontSize: 12, color: colors.textMuted } }, t('Live values')),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: Object.assign({}, btnStyle, { padding: '5px 9px', fontSize: 12 }),
                                            disabled: formulaLiveLoading || !(socket && typeof socket.getState === 'function'),
                                            onClick: () => refreshFormulaLiveValues({ reason: 'manual' }),
                                            title: t('Refresh'),
                                        },
                                        formulaLiveLoading ? t('Loading…') : t('Refresh')
                                    )
                                ),
                                vars.length
                                    ? vars.map((v, idx) => {
                                          const title = v.sourceState ? `${v.rawKey} ← ${v.sourceState}` : v.rawKey;
                                          const liveId = v.sourceState;
                                          const rawLiveVal = liveId ? formulaLiveValues[liveId] : undefined;
                                          const liveVal = liveId ? computePreviewInputValue(selectedItem, v, rawLiveVal) : undefined;
                                          const liveTs = liveId ? formulaLiveTs[liveId] : undefined;
                                          const liveText = liveId
                                              ? liveVal === undefined
                                                    ? t('n/a')
                                                    : stringifyCompact(liveVal)
                                              : t('n/a');
                                          return React.createElement(
                                              'div',
                                              {
                                                  key: `${v.key}|${idx}`,
                                                  style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' },
                                              },
                                              React.createElement(
                                                  'button',
                                                  {
                                                      type: 'button',
                                                      style: chipBtnStyle,
                                                      onClick: () => insertIntoFormulaDraft({ text: v.key }),
                                                      title,
                                                  },
                                                  v.key,
                                                  v.rawKey && v.rawKey !== v.key
                                                      ? React.createElement(
                                                            'span',
                                                            { style: { fontSize: 11, opacity: 0.75 } },
                                                            `(${v.rawKey})`
                                                        )
                                                      : null
                                              ),
                                              v.sourceState
                                                  ? React.createElement(
                                                        'span',
                                                        {
                                                            style: valuePillStyle,
                                                            title: liveTs
                                                                ? `${liveText} @ ${new Date(liveTs).toLocaleString()}`
                                                                : liveText,
                                                        },
                                                        liveText
                                                    )
                                                  : null
                                          );
                                      })
                                    : React.createElement(
                                          'div',
                                          { style: { fontSize: 12, color: colors.textMuted } },
                                          t('No inputs configured yet.')
                                      ),

                                React.createElement('div', { style: sectionTitleStyle }, t('Operators')),
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                                    ['+', '-', '*', '/', '%', '(', ')', '&&', '||', '!', '==', '!=', '>=', '<=', '>', '<', '?', ':'].map(op =>
                                        React.createElement(
                                            'button',
                                            {
                                                key: op,
                                                type: 'button',
                                                style: chipBtnStyle,
                                                onClick: () => insertIntoFormulaDraft({ text: op }),
                                            },
                                            op
                                        )
                                    )
                                ),

                                React.createElement('div', { style: sectionTitleStyle }, t('Functions')),
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: chipBtnStyle,
                                            onClick: () =>
                                                insertIntoFormulaDraft({ text: 'min(a, b)', selectStartWithinText: 4, selectEndWithinText: 5 }),
                                        },
                                        t('min')
                                    ),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: chipBtnStyle,
                                            onClick: () =>
                                                insertIntoFormulaDraft({ text: 'max(a, b)', selectStartWithinText: 4, selectEndWithinText: 5 }),
                                        },
                                        t('max')
                                    ),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: chipBtnStyle,
                                            onClick: () =>
                                                insertIntoFormulaDraft({
                                                    text: 'clamp(value, min, max)',
                                                    selectStartWithinText: 6,
                                                    selectEndWithinText: 11,
                                                }),
                                        },
                                        t('clamp')
                                    ),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: chipBtnStyle,
                                            onClick: () =>
                                                insertIntoFormulaDraft({
                                                    text: 'IF(condition, valueIfTrue, valueIfFalse)',
                                                    selectStartWithinText: 3,
                                                    selectEndWithinText: 12,
                                                }),
                                        },
                                        t('IF')
                                    )
                                ),

                                React.createElement('div', { style: sectionTitleStyle }, t('State functions')),
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: DialogSelectID && socket && theme ? chipBtnStyle : chipBtnDisabledStyle,
                                            disabled: !(DialogSelectID && socket && theme),
                                            onClick: () => setSelectContext({ kind: 'formulaFn', fn: 's' }),
                                            title: t('Pick a state id and insert s("id")'),
                                        },
                                        t('Insert s()')
                                    ),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: DialogSelectID && socket && theme ? chipBtnStyle : chipBtnDisabledStyle,
                                            disabled: !(DialogSelectID && socket && theme),
                                            onClick: () => setSelectContext({ kind: 'formulaFn', fn: 'v' }),
                                            title: t('Pick a state id and insert v("id")'),
                                        },
                                        t('Insert v()')
                                    ),
                                    React.createElement(
                                        'button',
                                        {
                                            type: 'button',
                                            style: DialogSelectID && socket && theme ? chipBtnStyle : chipBtnDisabledStyle,
                                            disabled: !(DialogSelectID && socket && theme),
                                            onClick: () => setSelectContext({ kind: 'formulaFn', fn: 'jp' }),
                                            title: t('Pick a state id and insert jp("id", "$.value")'),
                                        },
                                        t('Insert jp()')
                                    )
                                )
                            ),
                            React.createElement(
                                'div',
                                { style: modalRightStyle },
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                                    React.createElement(
                                        'label',
                                        { style: Object.assign({}, labelStyle, { marginTop: 0 }) },
                                        t('Formula expression')
                                    ),
                                    React.createElement(
                                        'div',
                                        {
                                            style: {
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                gap: 8,
                                                flexWrap: 'wrap',
                                            },
                                        },
                                        React.createElement(
                                            'span',
                                            { style: { fontSize: 12, color: colors.textMuted } },
                                            t('Result')
                                        ),
                                        React.createElement(
                                            'button',
                                            {
                                                type: 'button',
                                                style: Object.assign({}, btnStyle, { padding: '5px 9px', fontSize: 12 }),
											disabled: formulaPreviewLoading,
											onClick: () => refreshFormulaPreview({ reason: 'manual', showLoading: true }),
                                                title: t('Refresh preview'),
                                            },
                                            formulaPreviewLoading ? t('Loading…') : t('Refresh')
                                        ),
                                        formulaPreview && formulaPreview.ok
                                            ? React.createElement(
                                                  'span',
                                                  { style: previewOkPillStyle, title: stringifyCompact(formulaPreview.value, 200) },
                                                  stringifyCompact(formulaPreview.value)
                                              )
                                            : formulaPreview && !formulaPreview.ok
                                              ? React.createElement(
                                                    'span',
                                                    { style: previewErrPillStyle, title: formulaPreview.error ? String(formulaPreview.error) : '' },
                                                    formulaPreview.error ? stringifyCompact(formulaPreview.error) : t('n/a')
                                                )
                                              : React.createElement('span', { style: valuePillStyle }, t('n/a'))
                                    )
                                ),
                                React.createElement('textarea', {
                                    ref: formulaEditorRef,
                                    style: Object.assign({}, inputStyle, {
                                        minHeight: 260,
                                        flex: 1,
                                        resize: 'none',
                                        fontFamily:
                                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                                        lineHeight: 1.45,
                                    }),
                                    value: formulaDraft,
                                    onChange: e => setFormulaDraft(e.target.value),
                                    placeholder: t('e.g. pv1 + pv2 + pv3'),
                                    spellCheck: false,
                                }),
                                React.createElement(
                                    'div',
                                    { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
                                    React.createElement(
                                        'div',
                                        { style: { fontSize: 12, color: colors.textMuted, alignSelf: 'center' } },
                                        t('Tip: You can still edit the formula as plain text anytime.')
                                    ),
                                    React.createElement(
                                        'div',
                                        { style: { display: 'flex', gap: 8 } },
                                        React.createElement('button', { type: 'button', style: btnStyle, onClick: close }, t('Cancel')),
                                        React.createElement('button', { type: 'button', style: btnStyle, onClick: apply }, t('Apply'))
                                    )
                                )
                            )
                        ),
                    )
                );
            };

            return React.createElement(
                'div',
                { style: rootStyle },
                DEBUG
                    ? React.createElement(
                          'div',
                          {
                              style: {
                                  position: 'absolute',
                                  right: 14,
                                  marginTop: -22,
                                  fontSize: 11,
                                  opacity: 0.7,
                                  color: colors.textMuted,
                                  pointerEvents: 'none',
                              },
                          },
                          `Items UI ${UI_VERSION}`
                      )
                    : null,
                React.createElement(
                    'div',
                    { style: leftStyle },
                    React.createElement(
                        'div',
                        { style: toolbarStyle },
                        React.createElement('button', { type: 'button', style: btnStyle, onClick: addItem }, t('Add')),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: cloneSelected, disabled: !selectedItem },
                            t('Duplicate')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnDangerStyle, onClick: deleteSelected, disabled: !selectedItem },
                            t('Delete')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 },
                            t('Up')
                        ),
                        React.createElement(
                            'button',
                            {
                                type: 'button',
                                style: btnStyle,
                                onClick: () => moveSelected(1),
                                disabled: selectedIndex >= items.length - 1,
                            },
                            t('Down')
                        )
                    ),
                    React.createElement(
                        'div',
                        { style: listStyle },
                        items.length
                            ? Object.keys(groupedItems).sort().map(folderName => {
                                  const folderItems = groupedItems[folderName];
                                  const isCollapsed = collapsedFolders[folderName];
                                  const activeCount = folderItems.filter(({ item }) => item.enabled).length;
                                  const inactiveCount = folderItems.length - activeCount;

                                  return React.createElement(
                                      React.Fragment,
                                      { key: folderName },
                                      React.createElement(
                                          'button',
                                          {
                                              type: 'button',
                                              style: folderBtnStyle,
                                              onClick: () => toggleFolder(folderName),
                                          },
                                          React.createElement(
                                              'span',
                                              { style: { width: 20, fontSize: 14 } },
                                              isCollapsed ? '▶' : '▼'
                                          ),
                                          React.createElement(
                                              'span',
                                              {
                                                  style: {
                                                      flex: 1,
                                                      minWidth: 0,
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap',
                                                  },
                                              },
                                              folderName
                                          ),
                                          React.createElement(
                                              'span',
                                              {
                                                  style: {
                                                      display: 'flex',
                                                      gap: 6,
                                                      alignItems: 'center',
                                                      fontSize: 12,
                                                  },
                                              },
                                              activeCount > 0
                                                  ? React.createElement(
                                                        'span',
                                                        {
                                                            title: `${activeCount} ${activeCount === 1 ? t('active item') : t('active items')}`,
                                                            style: {
                                                                background: '#10b981',
                                                                color: 'white',
                                                                borderRadius: '50%',
                                                                width: 24,
                                                                height: 24,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontWeight: 'bold',
                                                                fontSize: 11,
                                                            },
                                                        },
                                                        activeCount
                                                    )
                                                  : null,
                                              inactiveCount > 0
                                                  ? React.createElement(
                                                        'span',
                                                        {
                                                            title: `${inactiveCount} ${inactiveCount === 1 ? t('inactive item') : t('inactive items')}`,
                                                            style: {
                                                                background: isDark ? '#4b5563' : '#d1d5db',
                                                                color: isDark ? '#d1d5db' : '#4b5563',
                                                                borderRadius: '50%',
                                                                width: 24,
                                                                height: 24,
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontWeight: 'bold',
                                                                fontSize: 11,
                                                            },
                                                        },
                                                        inactiveCount
                                                    )
                                                  : null
                                          )
                                      ),
                                      !isCollapsed
                                          ? folderItems.map(({ item, index }) =>
                                                React.createElement(
                                                    'button',
                                                    {
                                                        key: index,
                                                        type: 'button',
                                                        style:
                                                            index === selectedIndex
                                                                ? folderItemActiveStyle
                                                                : folderItemStyle,
                                                        onClick: () => setSelectedIndex(index),
                                                    },
                                                    React.createElement(
                                                        'span',
                                                        { style: { width: 22 } },
                                                        item.enabled ? '🟢' : '⚪'
                                                    ),
                                                    React.createElement(
                                                        'span',
                                                        {
                                                            style: {
                                                                fontWeight: 600,
                                                                flex: 1,
                                                                minWidth: 0,
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            },
                                                            title: item.name || item.targetId || t('Unnamed'),
                                                        },
                                                        item.name || item.targetId || t('Unnamed')
                                                    )
                                                )
                                            )
                                          : null
                                  );
                              })
                            : React.createElement(
                                  'div',
                                  { style: { padding: 12, opacity: 0.9, color: colors.textMuted } },
                                  t('No items configured.')
                              )
                    )
                ),
                React.createElement(
                    'div',
                    { style: rightStyle },
                    selectedItem
                        ? React.createElement(
                              React.Fragment,
                              null,
                              React.createElement(
                                  'div',
                                  { style: headerBarStyle },
                                  React.createElement(
                                      'div',
                                      { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
                                      React.createElement('img', {
                                          src: logoUrl,
                                          width: 28,
                                          height: 28,
                                          style: { display: 'block', borderRadius: 6 },
                                          alt: 'Data-SOLECTRUS',
                                      }),
                                      React.createElement(
                                          'div',
                                          { style: { minWidth: 0 } },
                                          React.createElement(
                                              'div',
                                              { style: { fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                              'Data-SOLECTRUS'
                                          ),
                                          React.createElement(
                                              'div',
                                              { style: { fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                              t('Configured values')
                                          )
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 11, opacity: 0.7, color: colors.textMuted } },
                                      `UI ${UI_VERSION}`
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 16, fontWeight: 700 } },
                                      calcTitle(selectedItem, t)
                                  )
                              ),
                              React.createElement(
                                  'label',
                                  { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                                  React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!selectedItem.enabled,
                                      onChange: e => updateSelected('enabled', !!e.target.checked),
                                  }),
                                  React.createElement('span', null, t('Enabled'))
                              ),
                              React.createElement('label', { style: labelStyle }, t('Name')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.name || '',
                                  onChange: e => updateSelected('name', e.target.value),
                              }),
                              React.createElement('label', { style: labelStyle }, t('Folder/Group')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.group || '',
                                  onChange: e => updateSelected('group', e.target.value),
                                  placeholder: 'pv',
                              }),
                              React.createElement('label', { style: labelStyle }, t('Target ID')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: selectedItem.targetId || '',
                                  onChange: e => updateSelected('targetId', e.target.value),
                                  placeholder: 'pvGesamt',
                              }),
                              React.createElement('label', { style: labelStyle }, t('Mode')),
                              React.createElement(
                                  'div',
                                  { style: { position: 'relative' }, 'data-ds-dropdown': '1' },
                                  React.createElement(
                                      'div',
                                      {
                                          style: dropdownButtonStyle,
                                          role: 'button',
                                          tabIndex: 0,
                                          onClick: () => setOpenDropdown(openDropdown === 'mode' ? null : 'mode'),
                                          onKeyDown: e => {
                                              if (e && (e.key === 'Enter' || e.key === ' ')) {
                                                  e.preventDefault();
                                                  setOpenDropdown(openDropdown === 'mode' ? null : 'mode');
                                              }
                                          },
                                      },
                                      React.createElement(
                                          'span',
                                          null,
                                          (selectedItem.mode || 'formula') === 'source' ? t('Source') : t('Formula')
                                      ),
                                      React.createElement('span', { style: { opacity: 0.75 } }, '▾')
                                  ),
                                  openDropdown === 'mode'
                                      ? React.createElement(
                                            'div',
                                            { style: dropdownMenuStyle },
                                            React.createElement(
                                                'div',
                                                {
                                                    style: dropdownItemStyle((selectedItem.mode || 'formula') === 'formula'),
                                                    onClick: () => {
                                                        updateSelected('mode', 'formula');
                                                        setOpenDropdown(null);
                                                    },
                                                },
                                                t('Formula')
                                            ),
                                            React.createElement(
                                                'div',
                                                {
                                                    style: dropdownItemStyle((selectedItem.mode || 'formula') === 'source'),
                                                    onClick: () => {
                                                        updateSelected('mode', 'source');
                                                        setOpenDropdown(null);
                                                    },
                                                },
                                                t('Source')
                                            )
                                        )
                                      : null
                              ),
                              (selectedItem.mode || 'formula') === 'source'
                                  ? React.createElement(
                                        React.Fragment,
                                        null,
                                        React.createElement('label', { style: labelStyle }, t('ioBroker Source State')),
                                        React.createElement(
                                            'div',
                                            { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                                            React.createElement('input', {
                                                style: Object.assign({}, inputStyle, { flex: 1 }),
                                                type: 'text',
                                                value: selectedItem.sourceState || '',
                                                onChange: e => updateSelected('sourceState', e.target.value),
                                                placeholder: t('e.g. some.adapter.0.channel.state'),
                                            }),
                                            renderSelectButton(() => setSelectContext({ kind: 'itemSource' }))
                                        ),
									React.createElement('label', { style: labelStyle }, t('JSONPath (optional)')),
									React.createElement('input', {
										style: inputStyle,
										type: 'text',
										value: selectedItem.jsonPath || '',
										onChange: e => updateSelected('jsonPath', e.target.value),
										placeholder: t('e.g. $.apower'),
									})
                                    )
                                  : React.createElement(
                                        React.Fragment,
                                        null,
                                        React.createElement(
                                            'div',
                                            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 } },
                                            React.createElement('div', { style: labelStyle }, t('Inputs')),
                                            React.createElement(
                                                'button',
                                                { type: 'button', style: btnStyle, onClick: addInput },
                                                t('Add input')
                                            )
                                        ),
                                        (Array.isArray(selectedItem.inputs) ? selectedItem.inputs : []).map((inp, idx) =>
                                            React.createElement(
                                                'div',
                                                {
                                                    key: idx,
                                                    style: {
                                                        display: 'grid',
															gridTemplateColumns: '140px 1fr 160px 90px 90px',
                                                        gap: 8,
                                                        alignItems: 'center',
                                                        marginTop: 8,
                                                    },
                                                },
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: (inp && inp.key) || '',
                                                    placeholder: t('Key'),
                                                    onChange: e => updateInput(idx, 'key', e.target.value),
                                                }),
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: (inp && inp.sourceState) || '',
                                                    placeholder: t('ioBroker Source State'),
                                                    onChange: e => updateInput(idx, 'sourceState', e.target.value),
                                                }),
															React.createElement('input', {
																style: inputStyle,
																type: 'text',
																value: (inp && inp.jsonPath) || '',
																placeholder: t('JSONPath (optional)'),
																onChange: e => updateInput(idx, 'jsonPath', e.target.value),
																title: t('e.g. $.apower'),
															}),
                                                React.createElement(
                                                    'div',
                                                    { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' } },
                                                    React.createElement(
                                                        'label',
                                                        {
                                                            style: {
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 6,
                                                                fontSize: 11,
                                                                color: colors.textMuted,
                                                                cursor: 'pointer',
                                                            },
                                                            title: t('Clamp input negative to 0'),
                                                        },
                                                        React.createElement('input', {
                                                            type: 'checkbox',
                                                            checked: !!(inp && inp.noNegative),
                                                            onChange: e => updateInput(idx, 'noNegative', !!e.target.checked),
                                                        }),
                                                        React.createElement('span', null, 'neg→0')
                                                    ),
                                                    renderSelectButton(() => setSelectContext({ kind: 'input', index: idx }))
                                                ),
                                                React.createElement(
                                                    'button',
                                                    { type: 'button', style: btnDangerStyle, onClick: () => deleteInput(idx) },
                                                    t('Delete')
                                                )
                                            )
                                        ),
                                            React.createElement(
    										'div',
    										{ style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 } },
    										React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: 0 }) }, t('Formula expression')),
    										React.createElement(
    											'button',
    											{ type: 'button', style: Object.assign({}, btnStyle, { padding: '6px 10px' }), onClick: openFormulaBuilder },
    											t('Builder…')
    										)
    									),
                                        React.createElement('textarea', {
                                            style: Object.assign({}, inputStyle, { minHeight: 80 }),
                                            value: selectedItem.formula || '',
                                            onChange: e => updateSelected('formula', e.target.value),
                                            placeholder: t('e.g. pv1 + pv2 + pv3'),
                                        })
                                    ),
                              React.createElement(
                                  'div',
                                  { style: rowStyle2 },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Datatype')),
                                      React.createElement(
                                          'div',
                                          { style: { position: 'relative' }, 'data-ds-dropdown': '1' },
                                          React.createElement(
                                              'div',
                                              {
                                                  style: dropdownButtonStyle,
                                                  role: 'button',
                                                  tabIndex: 0,
                                                  onClick: () => setOpenDropdown(openDropdown === 'datatype' ? null : 'datatype'),
                                                  onKeyDown: e => {
                                                      if (e && (e.key === 'Enter' || e.key === ' ')) {
                                                          e.preventDefault();
                                                          setOpenDropdown(openDropdown === 'datatype' ? null : 'datatype');
                                                      }
                                                  },
                                              },
                                              React.createElement(
                                                  'span',
                                                  null,
                                                  selectedItem.type === 'number'
                                                      ? t('Number')
                                                      : selectedItem.type === 'boolean'
                                                            ? t('Boolean')
                                                            : selectedItem.type === 'string'
                                                                  ? t('String')
                                                                  : selectedItem.type === 'mixed'
                                                                        ? t('Mixed')
                                                                        : t('Standard')
                                              ),
                                              React.createElement('span', { style: { opacity: 0.75 } }, '▾')
                                          ),
                                          openDropdown === 'datatype'
                                              ? React.createElement(
                                                    'div',
                                                    { style: dropdownMenuStyle },
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(!selectedItem.type),
                                                            onClick: () => {
                                                                updateSelected('type', '');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Standard')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'number'),
                                                            onClick: () => {
                                                                updateSelected('type', 'number');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Number')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'boolean'),
                                                            onClick: () => {
                                                                updateSelected('type', 'boolean');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Boolean')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'string'),
                                                            onClick: () => {
                                                                updateSelected('type', 'string');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('String')
                                                    ),
                                                    React.createElement(
                                                        'div',
                                                        {
                                                            style: dropdownItemStyle(selectedItem.type === 'mixed'),
                                                            onClick: () => {
                                                                updateSelected('type', 'mixed');
                                                                setOpenDropdown(null);
                                                            },
                                                        },
                                                        t('Mixed')
                                                    )
                                                )
                                              : null
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Role')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: selectedItem.role || '',
                                          onChange: e => updateSelected('role', e.target.value),
                                          placeholder: 'value.power',
                                      })
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  { style: rowStyle2 },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Unit')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: selectedItem.unit || '',
                                          onChange: e => updateSelected('unit', e.target.value),
                                          placeholder: 'W',
                                      })
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement(
                                          'label',
                                          { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
                                          React.createElement('input', {
                                              type: 'checkbox',
                                              checked: !!selectedItem.clamp,
                                              onChange: e => updateSelected('clamp', !!e.target.checked),
                                          }),
                                          React.createElement('span', null, t('Clamp result'))
                                      )
                                  )
                              ),
                              React.createElement(
                                  'label',
                                  {
                                      style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 },
                                      title: t('Clamp negative to 0 (tooltip)')
                                  },
                                  React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!selectedItem.noNegative,
                                      onChange: e => updateSelected('noNegative', !!e.target.checked),
                                  }),
                                  React.createElement('span', null, t('Clamp negative to 0'))
                              ),
                              React.createElement(
                                  'div',
                                  { style: { marginLeft: 26, marginTop: 4, fontSize: 12, color: colors.textMuted } },
                                  t(selectedItem && selectedItem.mode === 'formula'
                                      ? 'Clamp negative to 0 (hint formula)'
                                      : 'Clamp negative to 0 (hint source)')
                              ),
                              selectedItem.clamp
                                  ? React.createElement(
                                        'div',
                                        { style: rowStyle2 },
                                        React.createElement(
                                            'div',
                                            null,
                                            React.createElement('label', { style: labelStyle }, t('Min')),
                                            React.createElement('input', {
                                                style: inputStyle,
                                                type: 'number',
                                                value: selectedItem.min || '',
                                                onChange: e => updateSelected('min', e.target.value),
                                            })
                                        ),
                                        React.createElement(
                                            'div',
                                            null,
                                            React.createElement('label', { style: labelStyle }, t('Max')),
                                            React.createElement('input', {
                                                style: inputStyle,
                                                type: 'number',
                                                value: selectedItem.max || '',
                                                onChange: e => updateSelected('max', e.target.value),
                                            })
                                        )
                                    )
                                  : null,
							renderFormulaBuilderModal(),
                              renderStatePicker()
                          )
                        : React.createElement(
                              'div',
                              { style: { opacity: 0.9, color: colors.textMuted } },
                              t('Select an item on the left or add a new one.')
                          )
                )
            );
        };
    }

    const moduleMap = {
        './Components': async function () {
            const React = globalThis.React || (await loadShared('react'));
            const AdapterReact = await loadShared('@iobroker/adapter-react-v5');
            if (!React) {
                throw new Error('DataSolectrusItems custom UI: React not available.');
            }
            const DataSolectrusItemsEditor = createDataSolectrusItemsEditor(React, AdapterReact);

            // Legacy global registry (best-effort)
            try {
                globalThis.customComponents = globalThis.customComponents || {};
                globalThis.customComponents.DataSolectrusItemsEditor = DataSolectrusItemsEditor;
            } catch {
                // ignore
            }

            return {
                default: {
                    DataSolectrusItemsEditor,
                },
            };
        },
        'Components': async function () {
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
