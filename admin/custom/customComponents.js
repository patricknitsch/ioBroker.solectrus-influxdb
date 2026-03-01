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

    const JSON_PRESETS = {
        forecast:     { tsField: 't', valField: 'y',            measurement: 'inverter_forecast',          field: 'power',       influxType: 'int' },
        clearsky:     { tsField: 't', valField: 'clearsky',     measurement: 'inverter_forecast_clearsky', field: 'power',       influxType: 'int' },
        temperature:  { tsField: 't', valField: 'temp',         measurement: 'outdoor_forecast',           field: 'temperature', influxType: 'float' },
        weather_code: { tsField: 't', valField: 'weather_code', measurement: 'weather_code',               field: 'code',        influxType: 'int' },
    };

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

            const cloneForDraft = item => {
                if (!item || typeof item !== 'object') return null;
                try {
                    return JSON.parse(JSON.stringify(item));
                } catch {
                    return Object.assign({}, item);
                }
            };

            // Draft copy of the selected sensor to avoid pushing changes to Admin on every keystroke.
            // Admin may re-render/remount custom controls on each props.onChange, which resets cursor.
            const [selectedDraft, setSelectedDraft] = React.useState(null);

            React.useEffect(() => {
                if (selectedIndex > sensors.length - 1) {
                    setSelectedIndex(Math.max(0, sensors.length - 1));
                }
            }, [sensors.length, selectedIndex]);

            const selectedSensor = sensors[selectedIndex] || null;

            React.useEffect(() => {
                setSelectedDraft(cloneForDraft(selectedSensor));
            }, [selectedIndex]);

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

                const cb = (nextData) => {
                    try {
                        if (props && typeof props.forceUpdate === 'function') {
                            props.forceUpdate([attr], nextData || props.data);
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
                    cb(nextData);
                    return;
                }

                // Legacy fallback: some environments may pass the field value directly.
                callOnChange('legacy value-only', nextSensors);
            };

            const editSensor = selectedDraft || selectedSensor || {};

            const ensureDraftBase = prevDraft => {
                if (prevDraft && typeof prevDraft === 'object') return prevDraft;
                return cloneForDraft(selectedSensor) || {};
            };

            const setDraftField = (field, value) => {
                setSelectedDraft(prev => {
                    const base = ensureDraftBase(prev);
                    const next = Object.assign({}, base);
                    next[field] = value;
                    return next;
                });
            };

            const updateSelected = (field, value) => {
                // Only recalculate title for fields that affect it
                const titleAffectingFields = ['enabled', 'SensorName'];
                const shouldUpdateTitle = titleAffectingFields.includes(field);

                const nextSensors = sensors.map((s, i) => {
                    if (i !== selectedIndex) return s;
                    const next = Object.assign({}, s || {});
                    next[field] = value;
                    return shouldUpdateTitle ? ensureTitle(next) : next;
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
                                      calcTitle(editSensor)
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
                                  value: editSensor.SensorName || '',
                                  onChange: e => setDraftField('SensorName', e.target.value),
                                  onBlur: e => updateSelected('SensorName', e.target.value),
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
                                      value: editSensor.sourceState || '',
                                      onChange: e => setDraftField('sourceState', e.target.value),
                                      onBlur: e => updateSelected('sourceState', e.target.value),
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
                              // Datatype selector
                              React.createElement('label', { style: labelStyle }, t('Datatype')),
                              React.createElement(
                                  'select',
                                  {
                                      style: Object.assign({}, inputStyle, { maxWidth: 300 }),
                                      value: selectedSensor.type || '',
                                      onChange: e => {
                                          updateSelected('type', e.target.value);
                                          // When switching to json, set default preset
                                          if (e.target.value === 'json' && !selectedSensor.jsonPreset) {
                                              updateSelected('jsonPreset', 'forecast');
                                              const p = JSON_PRESETS['forecast'];
                                              if (p) {
                                                  updateSelected('measurement', p.measurement);
                                                  updateSelected('field', p.field);
                                              }
                                          }
                                      },
                                  },
                                  React.createElement('option', { value: '' }, t('Standard')),
                                  React.createElement('option', { value: 'int' }, t('Integer')),
                                  React.createElement('option', { value: 'float' }, t('Float')),
                                  React.createElement('option', { value: 'bool' }, t('Boolean')),
                                  React.createElement('option', { value: 'string' }, t('String')),
                                  React.createElement('option', { value: 'json' }, t('JSON Array'))
                              ),
                              // JSON-specific fields (only when type === 'json')
                              selectedSensor.type === 'json'
                                  ? React.createElement(
                                        React.Fragment,
                                        null,
                                        // Preset selector
                                        React.createElement('label', { style: labelStyle }, t('JSON Preset')),
                                        React.createElement(
                                            'select',
                                            {
                                                style: Object.assign({}, inputStyle, { maxWidth: 300 }),
                                                value: selectedSensor.jsonPreset || 'forecast',
                                                onChange: e => {
                                                    const preset = e.target.value;
                                                    updateSelected('jsonPreset', preset);
                                                    const p = JSON_PRESETS[preset];
                                                    if (p) {
                                                        updateSelected('measurement', p.measurement);
                                                        updateSelected('field', p.field);
                                                        setDraftField('measurement', p.measurement);
                                                        setDraftField('field', p.field);
                                                    }
                                                },
                                            },
                                            React.createElement('option', { value: 'forecast' }, t('Forecast (y)')),
                                            React.createElement('option', { value: 'clearsky' }, t('Clearsky')),
                                            React.createElement('option', { value: 'temperature' }, t('Temperature (temp)')),
                                            React.createElement('option', { value: 'weather_code' }, t('Weather Code')),
                                            React.createElement('option', { value: 'custom' }, t('Custom'))
                                        ),
                                        // Info box for presets
                                        (selectedSensor.jsonPreset || 'forecast') !== 'custom'
                                            ? React.createElement(
                                                  'div',
                                                  {
                                                      style: {
                                                          marginTop: 8,
                                                          padding: 10,
                                                          borderRadius: 6,
                                                          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                                                          fontSize: 13,
                                                          color: colors.textMuted,
                                                          lineHeight: 1.6,
                                                          fontFamily: 'monospace',
                                                      },
                                                  },
                                                  (function () {
                                                      var p = JSON_PRESETS[selectedSensor.jsonPreset || 'forecast'] || JSON_PRESETS.forecast;
                                                      return [
                                                          t('Timestamp Field') + ': ' + p.tsField,
                                                          t('Value Field') + ': ' + p.valField,
                                                          t('Influx Measurement') + ': ' + p.measurement,
                                                          t('Influx Field') + ': ' + p.field,
                                                          t('Influx Type') + ': ' + p.influxType,
                                                      ].join('\n');
                                                  })()
                                              )
                                            : null,
                                        // Custom JSON fields
                                        (selectedSensor.jsonPreset || 'forecast') === 'custom'
                                            ? React.createElement(
                                                  React.Fragment,
                                                  null,
                                                  React.createElement(
                                                      'div',
                                                      { style: rowStyle },
                                                      React.createElement(
                                                          'div',
                                                          null,
                                                          React.createElement('label', { style: labelStyle }, t('JSON Timestamp Field')),
                                                          React.createElement('input', {
                                                              style: inputStyle,
                                                              type: 'text',
                                                              value: editSensor.jsonTsField || 't',
                                                              placeholder: 't',
                                                              onChange: e => setDraftField('jsonTsField', e.target.value),
                                                              onBlur: e => updateSelected('jsonTsField', e.target.value),
                                                          })
                                                      ),
                                                      React.createElement(
                                                          'div',
                                                          null,
                                                          React.createElement('label', { style: labelStyle }, t('JSON Value Field')),
                                                          React.createElement('input', {
                                                              style: inputStyle,
                                                              type: 'text',
                                                              value: editSensor.jsonValField || 'y',
                                                              placeholder: 'y',
                                                              onChange: e => setDraftField('jsonValField', e.target.value),
                                                              onBlur: e => updateSelected('jsonValField', e.target.value),
                                                          })
                                                      )
                                                  ),
                                                  React.createElement('label', { style: labelStyle }, t('Influx Type')),
                                                  React.createElement(
                                                      'select',
                                                      {
                                                          style: Object.assign({}, inputStyle, { maxWidth: 200 }),
                                                          value: selectedSensor.jsonInfluxType || 'float',
                                                          onChange: e => updateSelected('jsonInfluxType', e.target.value),
                                                      },
                                                      React.createElement('option', { value: 'int' }, t('Integer')),
                                                      React.createElement('option', { value: 'float' }, t('Float'))
                                                  ),
                                                  React.createElement(
                                                      'div',
                                                      { style: rowStyle },
                                                      React.createElement(
                                                          'div',
                                                          null,
                                                          React.createElement('label', { style: labelStyle }, t('Influx Measurement')),
                                                          React.createElement('input', {
                                                              style: inputStyle,
                                                              type: 'text',
                                                              value: editSensor.measurement || '',
                                                              placeholder: t('e.g. inverter_forecast'),
                                                              onChange: e => setDraftField('measurement', e.target.value),
                                                              onBlur: e => updateSelected('measurement', e.target.value),
                                                          })
                                                      ),
                                                      React.createElement(
                                                          'div',
                                                          null,
                                                          React.createElement('label', { style: labelStyle }, t('Influx Field')),
                                                          React.createElement('input', {
                                                              style: inputStyle,
                                                              type: 'text',
                                                              value: editSensor.field || '',
                                                              placeholder: t('e.g. power'),
                                                              onChange: e => setDraftField('field', e.target.value),
                                                              onBlur: e => updateSelected('field', e.target.value),
                                                          })
                                                      )
                                                  )
                                              )
                                            : null,
                                        // JSON hint
                                        React.createElement(
                                            'div',
                                            {
                                                style: {
                                                    marginTop: 12,
                                                    padding: 12,
                                                    borderRadius: 6,
                                                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                                                    fontSize: 13,
                                                    color: colors.textMuted,
                                                    lineHeight: 1.5,
                                                },
                                            },
                                            t('jsonSensorDetailHint')
                                        )
                                    )
                                  : null,
                              // Standard sensor fields (measurement + field) - only when NOT json type
                              selectedSensor.type !== 'json'
                                  ? React.createElement(
                                        React.Fragment,
                                        null,
                                        React.createElement(
                                            'div',
                                            { style: rowStyle },
                                            React.createElement(
                                                'div',
                                                null,
                                                React.createElement('label', { style: labelStyle }, t('Influx Measurement')),
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: editSensor.measurement || '',
                                                    onChange: e => setDraftField('measurement', e.target.value),
                                                    onBlur: e => updateSelected('measurement', e.target.value),
                                                })
                                            ),
                                            React.createElement(
                                                'div',
                                                null,
                                                React.createElement('label', { style: labelStyle }, t('Influx Field')),
                                                React.createElement('input', {
                                                    style: inputStyle,
                                                    type: 'text',
                                                    value: editSensor.field || '',
                                                    onChange: e => setDraftField('field', e.target.value),
                                                    onBlur: e => updateSelected('field', e.target.value),
                                                })
                                            )
                                        )
                                    )
                                  : null,
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
                                                setDraftField('sourceState', selectedStr);
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
