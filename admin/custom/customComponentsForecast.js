/* eslint-disable */
/* eslint-disable prettier/prettier */
// @ts-nocheck

// Minimal Module Federation remote container for ioBroker Admin jsonConfig "custom" control.
// Exposes: SolectrusForecast/Components -> default export is an object containing { SolectrusForecastEditor }.
(function () {
    'use strict';

    const REMOTE_NAME = 'SolectrusForecast';
    const UI_VERSION = '2026-02-26 20260226-1';
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

    const TEMPLATES = [
        { name: 'INVERTER_POWER_FORECAST', basePath: 'pvforecast.0.summary.power', measurement: 'inverter_forecast', field: 'power', type: 'int' },
        { name: 'INVERTER_POWER_FORECAST_CLEARSKY', basePath: 'pvforecast.0.summary.power_clearsky', measurement: 'inverter_forecast_clearsky', field: 'power', type: 'int' },
        { name: 'OUTDOOR_TEMP_FORECAST', basePath: 'pvforecast.0.summary.temperature', measurement: 'outdoor_forecast', field: 'temperature', type: 'float' },
    ];

    function normalizeForecasts(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(forecast) {
        const name = forecast && forecast.name ? forecast.name : 'Forecast';
        const enabled = !!(forecast && forecast.enabled);
        return `${enabled ? '🟢 ' : '⚪ '}${name}`;
    }

    function ensureTitle(forecast) {
        return Object.assign({}, forecast || {}, { _title: calcTitle(forecast || {}) });
    }

    function makeNewForecast() {
        const forecast = {
            enabled: false,
            name: '',
            basePath: '',
            folders: [],
            measurement: '',
            field: '',
            type: 'int',
            interval: 900,
        };
        return ensureTitle(forecast);
    }

    function makeFromTemplate(template) {
        const forecast = {
            enabled: false,
            name: template.name,
            basePath: template.basePath,
            folders: [],
            measurement: template.measurement,
            field: template.field,
            type: template.type,
            interval: 900,
        };
        return ensureTitle(forecast);
    }

    function guessDayOffset(folderName) {
        const lower = folderName.toLowerCase();
        if (lower.includes('today') || lower === 'hours_today') return 0;
        if (lower.includes('tomorrow') || lower === 'hours_tomorrow') return 1;
        // Try to extract number: hoursDay3 -> 2, hoursDay4 -> 3, etc.
        const match = lower.match(/day\s*(\d+)/);
        if (match) return parseInt(match[1], 10) - 1;
        return 0;
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

            const forecasts = dataIsArray
                ? normalizeForecasts(props.data)
                : normalizeForecasts(props.data && props.data[attr]);

            const [selectedIndex, setSelectedIndex] = React.useState(0);
            const [showTemplateMenu, setShowTemplateMenu] = React.useState(false);
            const [scanning, setScanning] = React.useState(false);

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

            React.useEffect(() => {
                if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                    const dataKeys = props && props.data && typeof props.data === 'object' && !Array.isArray(props.data)
                        ? Object.keys(props.data)
                        : [];
                    console.info('[SolectrusForecastEditor] mounted', {
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
                    });
                }
            }, []);

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
                        if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                            const dataKeys = dataIsObject ? Object.keys(props.data || {}) : [];
                            console.info('[SolectrusForecastEditor] onChange', {
                                label,
                                attr,
                                custom: !!(props && props.custom),
                                dataType: dataIsArray ? 'array' : typeof (props && props.data),
                                dataKeys,
                                nextForecastsLength: Array.isArray(nextForecasts) ? nextForecasts.length : undefined,
                                onChangeLength: typeof onChange === 'function' ? onChange.length : undefined,
                            });
                        }
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
                    if (DEBUG && typeof console !== 'undefined' && typeof console.info === 'function') {
                        console.info('[SolectrusForecastEditor] nextData', {
                            keys: nextData && typeof nextData === 'object' ? Object.keys(nextData) : null,
                            hasInflux: !!(nextData && nextData.influx),
                            hasForecasts: !!(nextData && nextData.forecasts),
                        });
                    }
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

                const nextForecasts = forecasts.map((s, i) => {
                    if (i !== selectedIndex) return s;
                    const next = Object.assign({}, s || {});
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

            const addFromTemplate = template => {
                const nextForecasts = forecasts.concat([makeFromTemplate(template)]);
                updateForecasts(nextForecasts);
                setSelectedIndex(nextForecasts.length - 1);
                setShowTemplateMenu(false);
            };

            const deleteSelected = () => {
                if (!selectedForecast) return;
                const nextForecasts = forecasts.slice();
                nextForecasts.splice(selectedIndex, 1);
                updateForecasts(nextForecasts);
                setSelectedIndex(Math.max(0, selectedIndex - 1));
            };

            const scanFolders = async () => {
                const basePath = editForecast.basePath || '';
                if (!socket || !basePath) return;
                setScanning(true);
                try {
                    const prefix = basePath + '.';
                    const result = await socket.getObjectView('system', 'state', { startkey: prefix, endkey: prefix + '\u9999' });
                    const rows = (result && result.rows) || [];
                    const folderSet = new Set();
                    for (const row of rows) {
                        const id = row.id || '';
                        const rest = id.slice(prefix.length);
                        const parts = rest.split('.');
                        if (parts.length >= 2) {
                            folderSet.add(parts[0]);
                        }
                    }
                    const sortedFolders = Array.from(folderSet).sort();
                    const existingMap = {};
                    (editForecast.folders || []).forEach(f => { existingMap[f.folder] = f; });

                    const newFolders = sortedFolders.map(folder => {
                        if (existingMap[folder]) return existingMap[folder];
                        return { folder: folder, dayOffset: guessDayOffset(folder), enabled: true };
                    });
                    setDraftField('folders', newFolders);
                    updateSelected('folders', newFolders);
                } catch (e) {
                    console.error('[SolectrusForecast] scan failed', e);
                }
                setScanning(false);
            };

            const updateFolderField = (folderIndex, field, value) => {
                const currentFolders = (editForecast.folders || []).slice();
                if (folderIndex < 0 || folderIndex >= currentFolders.length) return;
                currentFolders[folderIndex] = Object.assign({}, currentFolders[folderIndex], { [field]: value });
                setDraftField('folders', currentFolders);
                updateSelected('folders', currentFolders);
            };

            // --- Styles ---
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

            // --- Template dropdown ---
            const templateMenuRef = React.useRef(null);

            React.useEffect(() => {
                if (!showTemplateMenu) return;
                const handleClickOutside = e => {
                    if (templateMenuRef.current && !templateMenuRef.current.contains(e.target)) {
                        setShowTemplateMenu(false);
                    }
                };
                document.addEventListener('mousedown', handleClickOutside);
                return () => document.removeEventListener('mousedown', handleClickOutside);
            }, [showTemplateMenu]);

            // --- Folders section ---
            const currentFolders = editForecast.folders || [];

            const folderRowStyle = {
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: `1px solid ${colors.rowBorder}`,
            };

            const folderNameStyle = {
                flex: 1,
                fontSize: 13,
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: colors.text,
            };

            const folderOffsetInputStyle = Object.assign({}, inputStyle, {
                width: 70,
                padding: '4px 6px',
                fontSize: 13,
                textAlign: 'center',
            });

            // --- Render ---
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
                          `Forecast UI ${UI_VERSION}`
                      )
                    : null,
                // Left panel
                React.createElement(
                    'div',
                    { style: leftStyle },
                    React.createElement(
                        'div',
                        { style: toolbarStyle },
                        // Add button
                        React.createElement('button', { type: 'button', style: btnStyle, onClick: addForecast }, t('Add')),
                        // Template dropdown button
                        React.createElement(
                            'div',
                            { style: { position: 'relative', display: 'inline-block' }, ref: templateMenuRef },
                            React.createElement(
                                'button',
                                {
                                    type: 'button',
                                    style: btnStyle,
                                    onClick: () => setShowTemplateMenu(!showTemplateMenu),
                                },
                                t('Add Template') + ' \u25BE'
                            ),
                            showTemplateMenu
                                ? React.createElement(
                                      'div',
                                      {
                                          style: {
                                              position: 'absolute',
                                              top: '100%',
                                              left: 0,
                                              zIndex: 1000,
                                              background: isDark ? '#2a2a2a' : '#ffffff',
                                              border: `1px solid ${colors.border}`,
                                              borderRadius: 6,
                                              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                                              minWidth: 280,
                                              marginTop: 2,
                                          },
                                      },
                                      TEMPLATES.map((tmpl, idx) =>
                                          React.createElement(
                                              'button',
                                              {
                                                  key: idx,
                                                  type: 'button',
                                                  style: {
                                                      display: 'block',
                                                      width: '100%',
                                                      textAlign: 'left',
                                                      padding: '8px 12px',
                                                      border: 'none',
                                                      borderBottom: idx < TEMPLATES.length - 1 ? `1px solid ${colors.rowBorder}` : 'none',
                                                      background: 'transparent',
                                                      cursor: 'pointer',
                                                      fontFamily: 'inherit',
                                                      fontSize: 13,
                                                      color: colors.text,
                                                  },
                                                  onMouseEnter: e => { e.target.style.background = colors.hover; },
                                                  onMouseLeave: e => { e.target.style.background = 'transparent'; },
                                                  onClick: () => addFromTemplate(tmpl),
                                              },
                                              tmpl.name
                                          )
                                      )
                                  )
                                : null
                        ),
                        // Delete button
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: deleteSelected, disabled: !selectedForecast },
                            t('Delete')
                        ),
                        // Up button
                        React.createElement(
                            'button',
                            { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 },
                            t('Up')
                        ),
                        // Down button
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
                            ? forecasts.map((s, i) =>
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
                                              title: s.name || t('Unnamed'),
                                          },
                                          s.name || t('Unnamed')
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
                // Right panel (detail form)
                React.createElement(
                    'div',
                    { style: rightStyle },
                    selectedForecast
                        ? React.createElement(
                              React.Fragment,
                              null,
                              // Header with name + Enabled checkbox
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
                                  onChange: e => setDraftField('name', e.target.value),
                                  onBlur: e => updateSelected('name', e.target.value),
                              }),
                              // Base Path
                              React.createElement('label', { style: labelStyle }, t('Base Path')),
                              React.createElement('input', {
                                  style: inputStyle,
                                  type: 'text',
                                  value: editForecast.basePath || '',
                                  placeholder: 'e.g. pvforecast.0.summary.power',
                                  onChange: e => setDraftField('basePath', e.target.value),
                                  onBlur: e => updateSelected('basePath', e.target.value),
                              }),
                              // Influx Measurement and Influx Field in a row
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
                                          onChange: e => setDraftField('field', e.target.value),
                                          onBlur: e => updateSelected('field', e.target.value),
                                      })
                                  )
                              ),
                              // Datatype and Interval in a row
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
                                              value: selectedForecast.type || 'int',
                                              onChange: e => updateSelected('type', e.target.value),
                                          },
                                          React.createElement('option', { value: 'int' }, t('Integer')),
                                          React.createElement('option', { value: 'float' }, t('Float'))
                                      )
                                  ),
                                  React.createElement(
                                      'div',
                                      null,
                                      React.createElement('label', { style: labelStyle }, t('Forecast Interval (s)')),
                                      React.createElement('input', {
                                          style: inputStyle,
                                          type: 'number',
                                          min: 60,
                                          max: 3600,
                                          value: selectedForecast.interval != null ? selectedForecast.interval : 900,
                                          onChange: e => {
                                              const val = parseInt(e.target.value, 10);
                                              if (!isNaN(val)) {
                                                  updateSelected('interval', Math.max(60, Math.min(3600, val)));
                                              }
                                          },
                                      })
                                  )
                              ),
                              // Folders section
                              React.createElement(
                                  'div',
                                  { style: { marginTop: 16 } },
                                  React.createElement(
                                      'div',
                                      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
                                      React.createElement(
                                          'span',
                                          { style: { fontSize: 14, fontWeight: 600 } },
                                          t('Folders')
                                      ),
                                      React.createElement(
                                          'button',
                                          {
                                              type: 'button',
                                              style: Object.assign({}, btnStyle, { fontSize: 12 }),
                                              disabled: scanning || !(editForecast.basePath),
                                              onClick: scanFolders,
                                          },
                                          scanning ? t('Scanning...') : t('Scan Folders')
                                      )
                                  ),
                                  currentFolders.length
                                      ? React.createElement(
                                            'div',
                                            null,
                                            // Header row
                                            React.createElement(
                                                'div',
                                                {
                                                    style: Object.assign({}, folderRowStyle, {
                                                        fontSize: 11,
                                                        color: colors.textMuted,
                                                        fontWeight: 600,
                                                        borderBottom: `1px solid ${colors.border}`,
                                                        padding: '2px 0 4px 0',
                                                    }),
                                                },
                                                React.createElement('span', { style: { width: 28, textAlign: 'center' } }, ''),
                                                React.createElement('span', { style: { flex: 1 } }, t('Folder')),
                                                React.createElement('span', { style: { width: 70, textAlign: 'center' } }, t('Day Offset'))
                                            ),
                                            // Folder rows
                                            currentFolders.map((f, fi) =>
                                                React.createElement(
                                                    'div',
                                                    { key: fi, style: folderRowStyle },
                                                    React.createElement('input', {
                                                        type: 'checkbox',
                                                        checked: !!f.enabled,
                                                        onChange: e => updateFolderField(fi, 'enabled', !!e.target.checked),
                                                        style: { width: 18, height: 18, margin: 0 },
                                                    }),
                                                    React.createElement(
                                                        'span',
                                                        { style: folderNameStyle, title: f.folder },
                                                        f.folder
                                                    ),
                                                    React.createElement('input', {
                                                        type: 'number',
                                                        style: folderOffsetInputStyle,
                                                        value: f.dayOffset != null ? f.dayOffset : 0,
                                                        onChange: e => {
                                                            const val = parseInt(e.target.value, 10);
                                                            if (!isNaN(val)) {
                                                                updateFolderField(fi, 'dayOffset', val);
                                                            }
                                                        },
                                                    })
                                                )
                                            )
                                        )
                                      : React.createElement(
                                            'div',
                                            { style: { padding: 8, opacity: 0.8, color: colors.textMuted, fontSize: 13 } },
                                            t('No folders found.')
                                        )
                              )
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
