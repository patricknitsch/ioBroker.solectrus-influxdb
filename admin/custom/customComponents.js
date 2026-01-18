(function () {
    const React = window.React;

    if (!React) {
        console.error('SolectrusSensorsEditor: React is not available');
        return;
    }

    function normalizeSensors(value) {
        return Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
    }

    function calcTitle(sensor) {
        const sensorName = sensor && sensor.SensorName ? sensor.SensorName : 'Sensor';
        const enabled = !!(sensor && sensor.enabled);
        return `${enabled ? '🟢 ' : '⚪ '}${sensorName}`;
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
        sensor._title = calcTitle(sensor);
        return sensor;
    }

    function SolectrusSensorsEditor(props) {
        const attr = props.name;
        const sensors = normalizeSensors(props.data && props.data[attr]);

        const [selectedIndex, setSelectedIndex] = React.useState(0);

        React.useEffect(() => {
            if (selectedIndex > sensors.length - 1) {
                setSelectedIndex(Math.max(0, sensors.length - 1));
            }
        }, [sensors.length, selectedIndex]);

        const updateSensors = nextSensors => {
            const nextData = Object.assign({}, props.data || {});
            nextData[attr] = nextSensors;
            if (typeof props.onChange === 'function') {
                props.onChange(nextData, true);
            }
        };

        const ensureTitle = sensor => Object.assign({}, sensor || {}, { _title: calcTitle(sensor || {}) });

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
        };

        const leftStyle = {
            width: 340,
            maxWidth: '40%',
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 6,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
        };

        const rightStyle = {
            flex: 1,
            border: '1px solid rgba(0,0,0,0.15)',
            borderRadius: 6,
            padding: 12,
        };

        const toolbarStyle = {
            display: 'flex',
            gap: 8,
            padding: 10,
            borderBottom: '1px solid rgba(0,0,0,0.12)',
            flexWrap: 'wrap',
        };

        const listStyle = {
            overflow: 'auto',
            flex: 1,
        };

        const btnStyle = {
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.20)',
            background: 'transparent',
            cursor: 'pointer',
        };

        const listBtnStyle = isActive => ({
            width: '100%',
            textAlign: 'left',
            padding: '10px 10px',
            border: 'none',
            borderBottom: '1px solid rgba(0,0,0,0.10)',
            background: isActive ? 'rgba(0, 0, 0, 0.06)' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
        });

        const labelStyle = { display: 'block', fontSize: 12, opacity: 0.85, marginTop: 10 };
        const inputStyle = {
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.20)',
            fontFamily: 'inherit',
            fontSize: 14,
        };

        const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

        return React.createElement(
            'div',
            { style: rootStyle },
            React.createElement(
                'div',
                { style: leftStyle },
                React.createElement(
                    'div',
                    { style: toolbarStyle },
                    React.createElement('button', { type: 'button', style: btnStyle, onClick: addSensor }, 'Add'),
                    React.createElement('button', { type: 'button', style: btnStyle, onClick: cloneSelected, disabled: !selectedSensor }, 'Clone'),
                    React.createElement('button', { type: 'button', style: btnStyle, onClick: deleteSelected, disabled: !selectedSensor }, 'Delete'),
                    React.createElement('button', { type: 'button', style: btnStyle, onClick: () => moveSelected(-1), disabled: selectedIndex <= 0 }, 'Up'),
                    React.createElement('button', { type: 'button', style: btnStyle, onClick: () => moveSelected(1), disabled: selectedIndex >= sensors.length - 1 }, 'Down')
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
                                  React.createElement('span', { style: { fontWeight: 600 } }, s.SensorName || '(unnamed)'),
                                  React.createElement('span', { style: { opacity: 0.75, marginLeft: 'auto' } }, s.field || '')
                              )
                          )
                        : React.createElement('div', { style: { padding: 12, opacity: 0.8 } }, 'No sensors configured.')
                )
            ),
            React.createElement(
                'div',
                { style: rightStyle },
                selectedSensor
                    ? React.createElement(
                          React.Fragment,
                          null,
                          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                              React.createElement('div', { style: { fontSize: 16, fontWeight: 700 } }, calcTitle(selectedSensor)),
                              React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                                  React.createElement('input', {
                                      type: 'checkbox',
                                      checked: !!selectedSensor.enabled,
                                      onChange: e => updateSelected('enabled', !!e.target.checked),
                                  }),
                                  React.createElement('span', null, 'Enabled')
                              )
                          ),

                          React.createElement('label', { style: labelStyle }, 'Sensor Name'),
                          React.createElement('input', {
                              style: inputStyle,
                              type: 'text',
                              value: selectedSensor.SensorName || '',
                              onChange: e => updateSelected('SensorName', e.target.value),
                          }),

                          React.createElement('label', { style: labelStyle }, 'ioBroker Source State (paste full state id)'),
                          React.createElement('input', {
                              style: inputStyle,
                              type: 'text',
                              value: selectedSensor.sourceState || '',
                              onChange: e => updateSelected('sourceState', e.target.value),
                              placeholder: 'e.g. some.adapter.0.channel.state',
                          }),

                          React.createElement('div', { style: rowStyle },
                              React.createElement(
                                  'div',
                                  null,
                                  React.createElement('label', { style: labelStyle }, 'Datatype'),
                                  React.createElement(
                                      'select',
                                      {
                                          style: inputStyle,
                                          value: selectedSensor.type || '',
                                          onChange: e => updateSelected('type', e.target.value),
                                      },
                                      React.createElement('option', { value: '' }, 'Default'),
                                      React.createElement('option', { value: 'int' }, 'Integer'),
                                      React.createElement('option', { value: 'float' }, 'Float'),
                                      React.createElement('option', { value: 'bool' }, 'Boolean'),
                                      React.createElement('option', { value: 'string' }, 'String')
                                  )
                              ),
                              React.createElement(
                                  'div',
                                  null,
                                  React.createElement('label', { style: labelStyle }, 'Influx Measurement'),
                                  React.createElement('input', {
                                      style: inputStyle,
                                      type: 'text',
                                      value: selectedSensor.measurement || 'solectrus',
                                      onChange: e => updateSelected('measurement', e.target.value),
                                  })
                              )
                          ),

                          React.createElement('label', { style: labelStyle }, 'Influx Field'),
                          React.createElement('input', {
                              style: inputStyle,
                              type: 'text',
                              value: selectedSensor.field || '',
                              onChange: e => updateSelected('field', e.target.value),
                          }),

                          React.createElement(
                              'div',
                              { style: { marginTop: 12, fontSize: 12, opacity: 0.8 } },
                              'Note: This is an experimental editor. The Source State is a plain text field here (no object browser yet).'
                          )
                      )
                    : React.createElement('div', { style: { opacity: 0.8 } }, 'Select a sensor on the left.')
            )
        );
    }

    window.customComponents = window.customComponents || {};
    window.customComponents.SolectrusSensorsEditor = SolectrusSensorsEditor;
})();
