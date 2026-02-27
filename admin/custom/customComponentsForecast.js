/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Minimal Module Federation remote container for ioBroker Admin jsonConfig "custom" control.
// Exposes: SolectrusForecast/Components -> default export is an object containing { SolectrusForecastEditor }.
(function () {
    'use strict';

    const REMOTE_NAME = 'SolectrusForecast';
    const UI_VERSION = '2026-02-27 20260227-1';
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

    function normalizeForecasts(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(fc) {
        const name = fc && fc.name ? fc.name : 'Forecast';
        const enabled = !!(fc && fc.enabled);
        return `${enabled ? '🟢 ' : '⚪ '}${name}`;
    }

    function ensureTitle(fc) {
        return Object.assign({}, fc || {}, { _title: calcTitle(fc || {}) });
    }

    function makeNewForecast() {
        const fc = {
            enabled: true,
            name: '',
            sourceState: '',
            tsField: 't',
            valField: 'y',
            measurement: '',
            field: 'power',
            type: 'int',
        };
        return ensureTitle(fc);
    }

    function createSolectrusForecastEditor(React, AdapterReact) {
        return function SolectrusForecastEditor(props) {
            const attr = (props && typeof props.attr === 'string' && props.attr) ? props.attr : 'forecasts';
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

            const forecasts = dataIsArray
                ? normalizeForecasts(props.data)
                : normalizeForecasts(props.data && props.data[attr]);

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

            const [selectedDraft, setSelectedDraft] = React.useState(null);

            React.useEffect(() => {
                if (selectedIndex > forecasts.length - 1) {
                    setSelectedIndex(Math.max(0, forecasts.length - 1));
                }
            }, [forecasts.length, selectedIndex]);

            const selectedForecast = forecasts[selectedIndex] || null;

            React.useEffect(() => {
                setSelectedDraft(cloneForDraft(selectedForecast));
            }, [selectedIndex]);

            const updateForecasts = nextForecasts => {
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
                        onChange(...args);
                    } catch (e) {
                        if (typeof console !== 'undefined' && typeof console.error === 'function') {
                            console.error('[SolectrusForecastEditor] onChange failed', e);
                        }
                    }
                };

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
                    callOnChange('custom-object attr/value', attr, nextForecasts);
                    return;
                }

                if (dataIsObject) {
                    const nextData = setByPath(props.data, attr, nextForecasts);
                    callOnChange('adapter-config full-data', nextData);
                    cb(nextData);
                    return;
                }

                callOnChange('legacy value-only', nextForecasts);
            };

            const editForecast = selectedDraft || selectedForecast || {};

            const ensureDraftBase = prevDraft => {
                if (prevDraft && typeof prevDraft === 'object') return prevDraft;
                return cloneForDraft(selectedForecast) || {};
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
                const titleAffectingFields = ['enabled', 'name'];
                const shouldUpdateTitle = titleAffectingFields.includes(field);

                const nextForecasts = forecasts.map((fc, i) => {
                    if (i !== selectedIndex) return fc;
                    const next = Object.assign({}, fc || {});
                    next[field] = value;
                    return shouldUpdateTitle ? ensureTitle(next) : next;
                });
                updateForecasts(nextForecasts);
            };

            const moveSelected = direction => {
                const from = selectedIndex;
                const to = from + direction;
                if (to < 0 || to >= forecasts.length) return;

                const nextForecasts = forecasts.slice();
                const tmp = nextForecasts[from];
                nextForecasts[from] = nextForecasts[to];
                nextForecasts[to] = tmp;

                updateForecasts(nextForecasts);
                setSelectedIndex(to);
            };

            const addForecast = () => {
                const nextForecasts = forecasts.concat([makeNewForecast()]);
                updateForecasts(nextForecasts);
                setSelectedIndex(nextForecasts.length - 1);
            };

            const cloneSelected = () => {
                if (!selectedForecast) return;
                const clone = ensureTitle(Object.assign({}, selectedForecast));
                const nextForecasts = forecasts.slice();
                nextForecasts.splice(selectedIndex + 1, 0, clone);
                updateForecasts(nextForecasts);
                setSelectedIndex(selectedIndex + 1);
            };

            const deleteSelected = () => {
                if (!selectedForecast) return;
                const nextForecasts = forecasts.slice();
                nextForecasts.splice(selectedIndex, 1);
                updateForecasts(nextForecasts);
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            };

            /* ---------- Styles ---------- */

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

            /* ---------- Render ---------- */

            return React.createElement(
                'div',
                { style: rootStyle },
                // Left panel: master list
                React.createElement(
                    'div',
                    { style: leftStyle },
                    React.createElement(
                        'div',
                        { style: toolbarStyle },
                        React.createElement('button', { type: 'button', style: btnStyle, onClick: addForecast }, t('Add')),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: cloneSelected, disabled: !selectedForecast },
                            t('Duplicate')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: deleteSelected, disabled: !selectedForecast },
                            t('Delete')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 },
                            t('Up')
                        ),
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(1), disabled: selectedIndex >= forecasts.length - 1 },
                            t('Down')
                        )
                    ),
                    React.createElement(
                        'div',
                        { style: listStyle },
                        forecasts.length
                            ? forecasts.map((fc, i) =>
                                  React.createElement(
                                      'button',
                                      {
                                          key: i,
                                          type: 'button',
                                          style: listBtnStyle(i === selectedIndex),
                                          onClick: () => setSelectedIndex(i),
                                      },
                                      React.createElement('span', { style: { width: 22 } }, fc.enabled ? '🟢' : '⚪'),
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
                                              title: fc.name || t('Unnamed'),
                                          },
                                          fc.name || t('Unnamed')
                                      )
                                  )
                              )
                            : React.createElement(
                                  'div',
                                  { style: { padding: 12, opacity: 0.9, color: colors.textMuted } },
                                  t('No forecasts configured.')
                              )
                    )
                ),
                // Right panel: detail editor
                React.createElement(
                    'div',
                    { style: rightStyle },
                    selectedForecast
                        ? React.createElement(
                              React.Fragment,
                              null,
                              // Header with title and enabled checkbox
                              React.createElement(
                                  'div',
                                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                                  React.createElement(
                                      'div',
                                      { style: { fontSize: 16, fontWeight: 700 } },
                                      calcTitle(editForecast)
                                  ),
                                  React.createElement(
                                      'label',
                                      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                      React.createElement('input', {
                                          type: 'checkbox',
                                          checked: !!selectedForecast.enabled,
                                          onChange: e => updateSelected('enabled', !!e.target.checked),
                                      }),
                                      React.createElement('span', null, t('Enabled'))
                                  )
                              ),
                              // Name
                              React.createElement('label', { style: labelStyle }, t('Name')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: editForecast.name || '',
                                  placeholder: t('e.g. INVERTER_POWER_FORECAST'),
                                  onChange: e => setDraftField('name', e.target.value),
                                  onBlur: e => updateSelected('name', e.target.value),
                              }),
                              // Source State with picker
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
                                      value: editForecast.sourceState || '',
                                      placeholder: t('e.g. pvforecast.0.summary.JSONData'),
                                      onChange: e => setDraftField('sourceState', e.target.value),
                                      onBlur: e => updateSelected('sourceState', e.target.value),
                                  }),
                                  React.createElement(
                                      'button',
                                      {
                                          type: 'button',
                                          style: Object.assign({}, btnStyle, { padding: '8px 10px' }),
                                          disabled: !(DialogSelectID && socket && theme),
                                          title: DialogSelectID && socket && theme
                                              ? t('Select from existing states')
                                              : t('Selection dialog not available'),
                                          onClick: () => setShowSelectStateId(true),
                                      },
                                      t('Select')
                                  )
                              ),
                              // JSON field mapping row
                              React.createElement(
                                  'div',
                                  { style: rowStyle },
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Timestamp Field')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: editForecast.tsField || '',
                                          placeholder: 't',
                                          onChange: e => setDraftField('tsField', e.target.value),
                                          onBlur: e => updateSelected('tsField', e.target.value),
                                      })
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Value Field')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'text',
                                          value: editForecast.valField || '',
                                          placeholder: 'y',
                                          onChange: e => setDraftField('valField', e.target.value),
                                          onBlur: e => updateSelected('valField', e.target.value),
                                      })
                                  )
                              ),
                              // InfluxDB mapping row
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
                                          value: editForecast.measurement || '',
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
                                          value: editForecast.field || '',
                                          placeholder: t('e.g. power'),
                                          onChange: e => setDraftField('field', e.target.value),
                                          onBlur: e => updateSelected('field', e.target.value),
                                      })
                                  )
                              ),
                              // Datatype
                              React.createElement('label', { style: labelStyle }, t('Datatype')),
                              React.createElement(
                                  'select',
                                  {
                                      style: Object.assign({}, inputStyle, { maxWidth: 200 }),
                                      value: selectedForecast.type || 'int',
                                      onChange: e => updateSelected('type', e.target.value),
                                  },
                                  React.createElement('option', { value: 'int' }, t('Integer')),
                                  React.createElement('option', { value: 'float' }, t('Float'))
                              ),
                              // Hint text
                              React.createElement(
                                  'div',
                                  {
                                      style: {
                                          marginTop: 20,
                                          padding: 12,
                                          borderRadius: 6,
                                          background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                                          fontSize: 13,
                                          color: colors.textMuted,
                                          lineHeight: 1.5,
                                      },
                                  },
                                  t('forecastEntryHint')
                              ),
                              // State picker dialog
                              showSelectStateId && DialogSelectID && socket && theme
                                  ? React.createElement(DialogSelectID, {
                                        key: 'selectStateId',
                                        imagePrefix: '../..',
                                        dialogName: (props && (props.adapterName || props.adapter)) || 'solectrus-influxdb',
                                        themeType: themeType || (props && props.themeType),
                                        theme: theme,
                                        socket: socket,
                                        types: 'state',
                                        selected: selectedForecast.sourceState || '',
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
                              t('Select a forecast on the left or add a new one.')
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
                    'SolectrusForecast custom UI: React not available (neither global nor via shared scope).'
                );
            }
            const SolectrusForecastEditor = createSolectrusForecastEditor(React, AdapterReact);
            return {
                default: {
                    SolectrusForecastEditor,
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
