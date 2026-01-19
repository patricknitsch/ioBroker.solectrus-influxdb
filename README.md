# ioBroker.solectrus-influxdb

[![NPM version](https://img.shields.io/npm/v/iobroker.solectrus-influxdb.svg)](https://www.npmjs.com/package/iobroker.solectrus-influxdb)
[![Downloads](https://img.shields.io/npm/dm/iobroker.solectrus-influxdb.svg)](https://www.npmjs.com/package/iobroker.solectrus-influxdb)
![Number of Installations](https://iobroker.live/badges/solectrus-influxdb-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/solectrus-influxdb-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.solectrus-influxdb.png?downloads=true)](https://nodei.co/npm/iobroker.solectrus-influxdb/)

**Tests:** ![Test and Release](https://github.com/patricknitsch/ioBroker.solectrus-influxdb/workflows/Test%20and%20Release/badge.svg)

# 🌞 SOLECTRUS InfluxDB Adapter for ioBroker

![ioBroker](https://img.shields.io/badge/ioBroker-Adapter-blue)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)
![InfluxDB](https://img.shields.io/badge/InfluxDB-2.x-orange)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 🇬🇧 English

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

---

## 🇩🇪 Deutsch

### Überblick
Der **SOLECTRUS InfluxDB Adapter** verbindet ioBroker-Datenpunkte mit **InfluxDB 2.x**.  
Sensoren werden über die Admin-Oberfläche konfiguriert, fremde States abonniert, intern gespiegelt und zyklisch nach InfluxDB geschrieben. Der Adapter basiert auf der HA-Integration SOLECTRUS von @ledermann. Die Daten sollen in die InfluxDB von SOLECTRUS geschrieben werden, können aber auch für andere InfluxDB's verwendet werden.

Typische Einsatzbereiche:
- Photovoltaik (Wechselrichter, Prognosen)
- Batteriesysteme
- Wärmepumpen
- Netzbezug / Einspeisung
- Wallboxen
- Benutzerdefinierte Leistungs- und Energiesensoren

---

## ✨ Features

- ✅ Schreiben von ioBroker-Zuständen nach InfluxDB  
- ✅ Frei konfigurierbare Sensoren (Messung, Feld, Typ)  
- ✅ **Zwischenspeicher (Buffer)** bei Influx-Ausfällen  
- ✅ **Persistenter Buffer** (überlebt Adapter-Neustarts)  
- ✅ **Automatischer Reconnect** zur InfluxDB  
- ✅ **Verifikation von URL / Token / Org / Bucket**  
- ✅ **Manuelles Leeren des Buffers** über Button  
- ✅ **Maximale Buffergröße** (Fail-Safe)  
- ✅ **Gezieltes Deaktivieren einzelner Sensoren bei Typkonflikten**  
- ✅ Saubere Trennung von Collect- und Flush-Loop  
- ✅ Produktionsreif (keine Datenverluste bei kurzen Ausfällen)  

---

## 🧠 Funktionsprinzip

Der Adapter arbeitet mit **zwei getrennten Loops**:

### 1️⃣ Collect-Loop
- Läuft alle *X Sekunden* (Standard: 5 s)  
- Liest die letzten bekannten Sensorwerte  
- Schreibt sie **in einen lokalen Buffer**  
- **Kein direkter Influx-Zugriff**

### 2️⃣ Flush-Loop
- Läuft zeitversetzt (Intervall + 5 s)  
- Prüft Influx-Verbindung (inkl. Testschreiben)  
- Schreibt alle gepufferten Punkte nach InfluxDB  
- Löscht den Buffer **nur bei Erfolg**

➡ Dadurch gehen **keine Messwerte verloren**, auch bei:
- InfluxDB-Reboot  
- Update / Wartung  
- Netzwerkproblemen  
- Adapter-Neustart  

---

## 📦 Buffer & Persistenz

- Buffer wird in `buffer.json` gespeichert  
- Liegt im Adapter-Verzeichnis  
- Wird beim Start automatisch geladen  
- Maximale Größe: **100.000 Punkte**  
- Bei Überschreitung werden die **ältesten Einträge verworfen**

### Manuelles Leeren
Über den State:

```
solectrus-influxdb.0.info.buffer.clear
```

(Button / Boolean)

---

## ⚙️ InfluxDB-Konfiguration

Pflichtfelder:
- **URL**
- **Token**
- **Organisation**
- **Bucket**

Der Adapter prüft die Verbindung aktiv durch ein **Testschreiben** (`adapter_connection_test`).

---

## 📡 Sensor-Konfiguration

Jeder Sensor wird in der UI konfiguriert mit:
- **SensorName**
- **Aktiviert**
- **ioBroker Quellstatus**
- **Influx Tabelle**
- **Influx Feld**
- **Datentyp** (`int`, `float`, `bool`, `string`)

---

## ⚠️ Field-Type-Conflict (InfluxDB)

- Konflikt wird erkannt
- **Nur der betroffene Sensor wird deaktiviert**
- Andere Sensoren laufen weiter
- Buffer wird geleert
- Fehler wird gespeichert in `info.lastError`

---

## 🧾 Info-States

| State | Beschreibung |
|-----|-------------|
| `info.connection` | InfluxDB verbunden |
| `info.buffer.size` | Anzahl gepufferter Punkte |
| `info.buffer.oldest` | Zeitstempel des ältesten Eintrags |
| `info.buffer.clear` | Button: Buffer löschen |
| `info.lastError` | Letzter kritischer Fehler |

---

## 🔄 Retry-Strategie

- Exponentielles Backoff
- Maximal: **5 Minuten**
- Nach Erfolg: Reset auf Normalintervall

---

## 🔄 Debugging

- Benutze Loglevel **Debug** für mehr Information 

---

### Voraussetzungen
- ioBroker >= aktuelle stabile Version
- Node.js >= 20
- InfluxDB 2.x

---

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

* (patricknitsch) Try fixing automatic npm release

### 0.3.2 (2026-01-19)

* (patricknitsch) change Repo from ssh to https

### 0.3.1 (2026-01-19)

* (Felliglanz) Fix some issues in UI

### 0.3.0 (2026-01-18)

* (patricknitsch) Better handling of Influx Connection, also if no sensor is active
* (Felliglanz) Rebuild of UI with actual status of each sensor

### 0.2.0 (2026-01-18)

* (patricknitsch) Refactoring code and improve readability
* (patricknitsch) Buffer values and send to Influx if Influx is online
* (patricknitsch) Save max. 100000 values and send all to Influx if Influx is online again
* (patricknitsch) Split Data Collecting and Influx writing
* (patricknitsch) Updated Translations

### 0.1.5 (2026-01-17)

* (Felliglanz) Improve sensor configuration UI (accordion)

### 0.1.4 (2026-01-15)

* (patricknitsch) Bugfix with Icon

### 0.1.3 (2026-01-15)

* (patricknitsch) Bugfix for License
* (patricknitsch) Bugfix for Interval
* (patricknitsch) Synchronize Names, Measurements and Fields to SOLECTRUS Documentation

### 0.1.2 (2026-01-14)
* (patricknitsch) change UI to look for Source in Tree

### 0.1.1 (2026-01-14)
* (patricknitsch) add more Debugging
* (patricknitsch) optimize translation

### 0.1.0 (2026-01-14)
* (patricknitsch) initial release

## License

Copyright (c) 2026 patricknitsch <patricknitsch@web.de>