# ioBroker.solectrus-influxdb

# 🌞 SOLECTRUS InfluxDB Adapter for ioBroker

---

### Overview
The **SOLECTRUS InfluxDB Adapter** connects ioBroker states to **InfluxDB 2.x**.  
It allows you to define sensors via `jsonConfig`, subscribe to foreign states, mirror them as adapter states, and periodically write them into InfluxDB. The adpater based on the HA-integration from @ledermann. The datas should be write into the InfluxDB from SOLECTRUS, but can als written into any other Influx DB.
Der Adapter basiert auf der HA-Integration SOLECTRUS von @ledermann. Die Daten sollen in die InfluxDB von SOLECTRUS geschrieben werden, können aber auch für andere InfluxDB's verwendet werden.

Typical use cases:
- Photovoltaics (inverters, forecasts)
- Battery systems
- Heat pumps
- Grid import/export
- Wallboxes
- Custom power/energy sensors

---

## ✨ Features

- ✅ Writing ioBroker states to InfluxDB
- ✅ Freely configurable sensors (measurement, field, type)
- ✅ **Buffer** in case of Influx failures  
- ✅ **Persistent buffer** (survives adapter restarts)
- ✅ **Automatic reconnection** to InfluxDB
- ✅ **Verification of URL / token / org / bucket**
- ✅ **Manual emptying of the buffer** via button  
- ✅ **Maximum buffer size** (fail-safe)
- ✅ **Targeted deactivation of individual sensors in case of type conflicts**
- ✅ Clean separation of collect and flush loops  
- ✅ Production-ready (no data loss during short outages)  

---

## 🧠 How it works

The Adapter works with **two seperate Loops**:

### 1️⃣ Collect loop
- Runs every *X seconds* (default: 5 s)  
- Reads the last known sensor values
- Writes them **to a local buffer**
- **No direct Influx access**

### 2️⃣ Flush loop
- Runs with a time delay (interval + 5 s)
- Checks Influx connection (including test write)  
- Writes all buffered points to InfluxDB  
- Deletes the buffer **only if successful**

➡ This means that **no measured values are lost**, even in the event of:
- InfluxDB reboot  
- Update / maintenance  
- Network problems  
- Adapter restart  

---

## 📦 Buffer & Persistence

- Buffer is stored in `buffer.json`  
- Located in the adapter directory  
- Loaded automatically at startup  
- Maximum size: **100,000 points**  
- If exceeded, the **oldest entries are discarded**

## # Manual emptying
Via the state:

```
solectrus-influxdb.0.info.buffer.clear
```

(Button / Boolean)

---

## ⚙️ InfluxDB-Configuration

Required fields:
- **URL**
- **Token**
- **Organization**
- **Bucket**

The adapter actively checks the connection by performing a **test write** (`adapter_connection_test`).

---

## 📡 Sensor configuration

Each sensor is configured in the UI with:
- **SensorName**
- **enabled**
- **ioBroker source State**
- **measurement**
- **field**
- **type** (`int`, `float`, `bool`, `string`)

---

## ⚠️ Field Type Conflict (InfluxDB)

- Conflict is detected
- **Only the affected sensor is disabled**
- Other sensors continue to run
- Buffer is emptied
- Error is stored in `info.lastError`

---

## 🧾 Info States

| State | Description |
|-----|-------------|
| `info.connection` | InfluxDB connected |
| `info.buffer.size` | Number of buffered points |
| `info.buffer.oldest` | Timestamp of oldest entry |
| `info.buffer.clear` | Button: Clear buffer |
| `info.lastError` | Last critical error |

---

## 🔄 Retry strategy

- Exponential backoff
- Maximum: **5 minutes**
- After success: Reset to normal interval

---

## 🔄 Debugging

- use Loglevel **Debug** for more Information 

---

### Requirements
- ioBroker >= latest stable
- Node.js >= 20
- InfluxDB 2.x
