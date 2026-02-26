# SOLECTRUS InfluxDB Adapter -- Documentation

## Table of Contents

1. [InfluxDB Configuration](#1-influxdb-configuration)
2. [Sensors](#2-sensors)
3. [Forecast Sources](#3-forecast-sources)
4. [Data-SOLECTRUS Formula Engine](#4-data-solectrus-formula-engine)
5. [Item Modes](#5-item-modes)
6. [Formula Builder](#6-formula-builder)
7. [State Machine Mode](#7-state-machine-mode)
8. [Data Runtime Settings](#8-data-runtime-settings)
9. [Monitoring & Buffer](#9-monitoring--buffer)
10. [Using Computed Values as Sensor Sources](#10-using-computed-values-as-sensor-sources)
11. [Debugging](#11-debugging)

---

## 1. InfluxDB Configuration

Open the adapter settings and go to the **InfluxDB** tab.

| Field | Description |
|-------|-------------|
| URL | InfluxDB 2.x server address (e.g. `http://192.168.1.10:8086`) |
| Organization | Your InfluxDB organization |
| Bucket | Target bucket for time-series data |
| Token | API token with **write** permissions |
| Polling Interval (s) | How often sensor values are collected (5-30 seconds) |

The adapter verifies the connection at startup by writing a test point. The connection state is shown in `info.connection`.

At the bottom of this tab you will find a checkbox to enable the **Data-SOLECTRUS** formula engine (see section 3).

---

## 2. Sensors

Go to the **Sensors** tab. The master/detail editor shows all configured sensors with their live enabled status.

### Adding a sensor

Click **Add** to create a new sensor, then configure:

| Setting | Description |
|---------|-------------|
| Enabled | Activate/deactivate the sensor |
| Sensor Name | Display name (also used for the ioBroker state ID under `sensors.*`) |
| ioBroker Source State | The source state to read values from. Use the **Select** button to browse the object tree. |
| Datatype | `int`, `float`, `bool`, or `string` |
| Influx Measurement | The InfluxDB measurement name (e.g. `INVERTER_POWER`) |
| Influx Field | The InfluxDB field name (e.g. `value`) |

At least one sensor must be enabled for data to be written.

### How sensors work

1. The adapter subscribes to each sensor's source state
2. Values are mirrored under `solectrus-influxdb.X.sensors.*`
3. On each polling interval, current values are added to the write buffer (**Collect**)
4. Immediately after collect, the buffer is flushed to InfluxDB (**Flush**)

### Collect & Flush Architecture

Collect and flush run near-simultaneously without blocking each other:

1. **Collect** gathers all sensor values and writes them into the buffer
2. **Immediate flush** -- after collect, the flush is triggered on the next event-loop tick (no additional wait interval)
3. **Snapshot-and-swap** -- when the flush starts, the current buffer is taken as a batch and replaced with a new empty array. While the flush awaits the InfluxDB response, a concurrent collect already writes into the new (empty) buffer. The batch is never modified during the flush.
4. **Failure recovery** -- if the flush fails, the batch is prepended back to the current buffer in chronological order. No values are lost.
5. **Overlap guard** -- an `isFlushing` flag prevents multiple flush operations from running concurrently

### NaN protection

Invalid values (`NaN` for int/float, `null`/`undefined` for strings) are automatically skipped with a log warning.

### Negative values

SOLECTRUS does not accept negative values. If a sensor delivers a negative value after adapter start, a warning is logged **once**. The values are still sent to InfluxDB but may cause incorrect evaluations there. To fix this, check your source states or use the Data-SOLECTRUS formula engine with the **Clamp negative to 0** option.

### Field type conflicts

If InfluxDB reports a field type conflict (e.g. writing a float to an existing int field), the affected sensor is automatically disabled and the buffer is cleared.

---

## 3. Forecast Sources

The **Forecast** tab allows you to collect entire folders of hourly forecast values (e.g. from the pvforecast adapter) and write them to InfluxDB with correct timestamps.

### How it works

1. pvforecast (or similar adapters) stores hourly forecast values in a tree structure:
   ```
   pvforecast.0.summary.power.hoursToday.11:00:00     → 1500
   pvforecast.0.summary.power.hoursTomorrow.11:00:00   → 1200
   pvforecast.0.summary.power.hoursDay3.11:00:00       → 900
   ```
2. Each folder (hoursToday, hoursTomorrow, etc.) represents a day
3. Each state name (11:00:00) represents the time of day
4. The adapter reads **all** states in each enabled folder and derives the correct UTC timestamp from the folder's day offset + the state name

### Configuration

Click **Add** or **Add Template** to create a forecast source:

| Setting | Description |
|---------|-------------|
| Name | SOLECTRUS sensor name (e.g. `INVERTER_POWER_FORECAST`) |
| Base Path | Object tree root (e.g. `pvforecast.0.summary.power`) |
| Influx Measurement | InfluxDB measurement name |
| Influx Field | InfluxDB field name |
| Datatype | `int` or `float` |
| Forecast Interval (s) | How often forecast data is collected (60-3600s, default 900 = 15 min) |

### Folders

Click **Scan Folders** to automatically discover sub-folders under the base path. Each folder can be individually enabled/disabled and gets a **Day Offset**:

| Folder | Day Offset |
|--------|-----------|
| hoursToday | 0 (today) |
| hoursTomorrow | 1 (tomorrow) |
| hoursDay3 | 2 (day after tomorrow) |
| … up to 7 days with pvnode | … |

The day offset is auto-guessed from the folder name but can be adjusted manually.

### Templates

Three pre-configured templates are available:

| Template | Base Path | Measurement | Field |
|----------|-----------|-------------|-------|
| INVERTER_POWER_FORECAST | pvforecast.0.summary.power | inverter_forecast | power |
| INVERTER_POWER_FORECAST_CLEARSKY | pvforecast.0.summary.power_clearsky | inverter_forecast_clearsky | power |
| OUTDOOR_TEMP_FORECAST | pvforecast.0.summary.temperature | outdoor_forecast | temperature |

### Collection behavior

- Forecast data uses a **separate timer** from regular sensors (default: every 15 minutes)
- Values are pushed into the same buffer as sensor data and flushed together
- Each collected value gets a **derived timestamp** (not `Date.now()` like regular sensors)

---

## 4. Data-SOLECTRUS Formula Engine

The formula engine is an optional feature that lets you compute derived values from any ioBroker states. Enable it by checking **Enable Data-SOLECTRUS (formula engine)** on the InfluxDB tab.

When enabled, two additional tabs appear:

- **Data Values** -- Configure computed items
- **Data Runtime** -- Global polling and snapshot settings

### Concepts

- **Items** are the building blocks. Each item reads one or more ioBroker states and produces an output state under `solectrus-influxdb.X.ds.*`
- Items can operate in three modes: **Source**, **Formula**, or **State Machine**
- Items can be organized into **folders/groups** for better overview
- Computed values can be used as sensor sources for InfluxDB storage

---

## 5. Item Modes

### Source Mode

Mirrors a single ioBroker state. Optionally extracts a value from a JSON payload using JSONPath.

| Setting | Description |
|---------|-------------|
| ioBroker Source State | The state to mirror |
| JSONPath (optional) | Extract a nested value, e.g. `$.apower` |
| Datatype | `number` (default), `boolean`, `string`, or `mixed` |
| Clamp negative to 0 | Replace negative output values with 0 |

### Formula Mode

Computes a value from multiple named inputs using a mathematical expression.

| Setting | Description |
|---------|-------------|
| Inputs | Named variables, each linked to an ioBroker source state |
| Formula expression | Mathematical expression using input variable names |
| Datatype | Output type |
| Clamp / Min / Max | Optional output clamping |

**Input configuration:**

| Field | Description |
|-------|-------------|
| Key | Variable name used in the formula (e.g. `pv1`) |
| ioBroker Source State | State to read the value from |
| JSONPath (optional) | Extract from JSON payload |
| Clamp input negative to 0 | Clamp this specific input before formula evaluation |

**Example formula:** `pv1 + pv2 + pv3`

### Available functions

| Function | Description | Example |
|----------|-------------|---------|
| `min(a, b)` | Smaller of two values | `min(5, 10)` = 5 |
| `max(a, b)` | Larger of two values | `max(0, value)` |
| `clamp(v, min, max)` | Clamp between bounds | `clamp(v, 0, 100)` |
| `IF(cond, then, else)` | Conditional | `IF(soc > 80, surplus, 0)` |
| `abs(v)` | Absolute value | `abs(-5)` = 5 |
| `round(v)` | Round to integer | `round(3.7)` = 4 |
| `floor(v)` / `ceil(v)` | Round down / up | `floor(3.7)` = 3 |
| `pow(base, exp)` | Power | `pow(2, 3)` = 8 |

### State functions (advanced)

These functions read ioBroker states directly in a formula, without defining named inputs:

| Function | Description | Example |
|----------|-------------|---------|
| `s("id")` | Read state as safe number (0 if unavailable) | `s("hm-rpc.0.power") + 100` |
| `v("id")` | Read state as raw value (string/number/boolean) | `v("mqtt.0.status")` |
| `jp("id", "$.path")` | Extract value from JSON state via JSONPath | `jp("shelly.0.json", "$.apower")` |

### Supported operators

`+`, `-`, `*`, `/`, `%`, `()`, `&&`, `||`, `!`, `==`, `!=`, `>=`, `<=`, `>`, `<`, `? :`

---

## 6. Formula Builder

Click **Builder...** next to the formula input to open the visual formula builder.

The builder provides:

- **Variables (Inputs)** -- Click to insert your named input variables
- **Operators** -- Click to insert operators with tooltips explaining each one
- **Functions** -- Insert function templates (`min`, `max`, `clamp`, `IF`)
- **State functions** -- Insert `s()`, `v()`, or `jp()` with a state picker dialog
- **Examples** -- Common formula patterns (PV sum, surplus, percentage, clamping, conditions)
- **Live preview** -- See the formula result in real-time (requires the adapter to be running)

The formula is always editable as plain text. The builder only inserts building blocks at the cursor position.

---

## 7. State Machine Mode

The state machine mode generates string or boolean states based on rules. Rules are evaluated top-to-bottom; the **first matching rule wins**.

This is useful for:
- Translating numeric status codes into readable labels
- Determining operating modes based on multiple sensor values
- Creating boolean flags from complex conditions

### Configuration

| Setting | Description |
|---------|-------------|
| Inputs | Named variables (same as formula mode) |
| Datatype | `string` or `boolean` |
| Rules | Ordered list of condition/output pairs |

### Rules

Each rule has:

| Field | Description |
|-------|-------------|
| Condition | A formula expression that evaluates to truthy/falsy. Use input variable names and operators. |
| Output Value | The string or boolean value to output when the condition matches. |

**Special conditions:**
- `true` or empty = default/fallback rule (always matches)
- Use input variables and operators: `soc < 10`, `battery > 80 && surplus > 0`

### Example

For an item with inputs `soc` (battery SOC) and `surplus` (PV surplus):

| Condition | Output Value |
|-----------|-------------|
| `soc < 10` | `Battery-Empty` |
| `soc < 30` | `Battery-Low` |
| `surplus > 1000 && soc > 80` | `Full-Export` |
| `true` | `Normal` |

Result: The output state will contain `Battery-Empty`, `Battery-Low`, `Full-Export`, or `Normal` depending on current values.

---

## 8. Data Runtime Settings

On the **Data Runtime** tab:

| Setting | Description | Default |
|---------|-------------|---------|
| Poll interval (seconds) | How often computed items are re-evaluated | 5 |
| Read inputs on tick (snapshot) | Read all input states fresh on each evaluation cycle | off |
| Snapshot delay (ms) | Wait time after snapshot read before evaluation | 0 |

---

## 9. Monitoring & Buffer

### Adapter states

| State | Description |
|-------|-------------|
| `info.connection` | `true` if InfluxDB is reachable |
| `info.buffer.size` | Number of buffered data points |
| `info.buffer.oldest` | Timestamp of the oldest buffered point |
| `info.buffer.clear` | Button to manually clear the buffer |
| `info.lastError` | Last critical error message |

### Data-SOLECTRUS states (when enabled)

Computed values appear under `solectrus-influxdb.X.ds.*` with per-item diagnostic states.

### Buffer behavior

- Values are persistently buffered to disk (`buffer.json`)
- Maximum buffer size: 100,000 points
- Flushing only occurs when an **active InfluxDB connection** is confirmed (`ensureInflux()` checks before every flush)
- On InfluxDB outage, retry intervals increase exponentially (up to 5 minutes)
- After reconnection, all buffered points are flushed
- During a flush, the buffer is never modified (snapshot-and-swap pattern)
- On flush failure, data is automatically restored to the buffer

---

## 10. Using Computed Values as Sensor Sources

You can use Data-SOLECTRUS computed values as input for sensors to write them to InfluxDB:

1. Create a computed item (source, formula, or state machine) in the **Data Values** tab
2. On the **Sensors** tab, add a new sensor
3. As **ioBroker Source State**, select the computed value state: `solectrus-influxdb.X.ds.<outputId>`
4. Configure measurement, field, and data type as usual

The adapter handles the initialization order automatically -- sensor subscriptions for `ds.*` states work even though the formula engine starts after sensor setup.

---

## 11. Debugging

Set the adapter log level to **Debug** for detailed output including:

- Sensor value collection
- InfluxDB write operations
- Formula evaluation details
- State machine rule matching
- Buffer operations
