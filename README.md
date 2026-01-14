# ioBroker.solectrus-influxdb

[![NPM version](https://img.shields.io/npm/v/iobroker.solectrus-influxdb.svg)](https://www.npmjs.com/package/iobroker.solectrus-influxdb)
[![Downloads](https://img.shields.io/npm/dm/iobroker.solectrus-influxdb.svg)](https://www.npmjs.com/package/iobroker.solectrus-influxdb)
![Number of Installations](https://iobroker.live/badges/solectrus-influxdb-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/solectrus-influxdb-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.solectrus-influxdb.png?downloads=true)](https://nodei.co/npm/iobroker.solectrus-influxdb/)

**Tests:** ![Test and Release](https://github.com/patricknitsch/ioBroker.solectrus-influxdb/workflows/Test%20and%20Release/badge.svg)

# 🌞 Solectrus InfluxDB Adapter for ioBroker

![ioBroker](https://img.shields.io/badge/ioBroker-Adapter-blue)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)
![InfluxDB](https://img.shields.io/badge/InfluxDB-2.x-orange)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 🇬🇧 English

### Overview
The **Solectrus InfluxDB Adapter** connects ioBroker states to **InfluxDB 2.x**.  
It allows you to define sensors via `jsonConfig`, subscribe to foreign states, mirror them as adapter states, and periodically write them into InfluxDB. The adpater based on the HA-integration from @ledermann. The datas should be write into the InfluxDB from Solectrus, but can als written into any other Influx DB.
Der Adapter basiert auf der HA-Integration Solectrus von @ledermann. Die Daten sollen in die InfluxDB von Solectrus geschrieben werden, können aber auch für andere InfluxDB's verwendet werden.

Typical use cases:
- Photovoltaics (inverters, forecasts)
- Battery systems
- Heat pumps
- Grid import/export
- Wallboxes
- Custom power/energy sensors

---

### Features
- Dynamic sensor configuration via Admin UI (jsonConfig)
- Supports `int`, `float`, `bool`, `string`
- Live updates via `stateChange`
- Periodic bulk writes to InfluxDB
- Connection health state (`info.connection`)
- Safe adapter lifecycle handling (start/stop/restart)
- Supports up to **20 custom user-defined sensors**

---

### Configuration

#### InfluxDB
| Field | Description |
|-----|-------------|
| URL | InfluxDB base URL |
| Organization | InfluxDB org |
| Bucket | Target bucket |
| Token | API token |
| Polling interval | Write interval in seconds |

#### Sensors
Each sensor consists of:
- Enabled
- Sensor Name
- ioBroker source state
- Datatype
- Measurement
- Field

Only enabled sensors are processed.

---

### Runtime Behavior
1. Adapter starts
2. InfluxDB connection is validated
3. Sensor states are created or updated
4. Foreign states are subscribed
5. State changes update internal cache
6. Cached values are written periodically to InfluxDB

---

### Developer Notes
- Adapter uses **compact mode**
- Uses `extendObject()` to update existing states
- Uses internal cache to avoid unnecessary reads
- Handles restart/unload cleanly
- Written in plain JavaScript (no TypeScript runtime)

---

### Requirements
- ioBroker >= latest stable
- Node.js >= 20
- InfluxDB 2.x

---

## 🇩🇪 Deutsch

### Überblick
Der **Solectrus InfluxDB Adapter** verbindet ioBroker-Datenpunkte mit **InfluxDB 2.x**.  
Sensoren werden über die Admin-Oberfläche konfiguriert, fremde States abonniert, intern gespiegelt und zyklisch nach InfluxDB geschrieben. Der Adapter basiert auf der HA-Integration Solectrus von @ledermann. Die Daten sollen in die InfluxDB von Solectrus geschrieben werden, können aber auch für andere InfluxDB's verwendet werden.

Typische Einsatzbereiche:
- Photovoltaik (Wechselrichter, Prognosen)
- Batteriesysteme
- Wärmepumpen
- Netzbezug / Einspeisung
- Wallboxen
- Benutzerdefinierte Leistungs- und Energiesensoren

---

### Funktionen
- Dynamische Sensorkonfiguration per Admin UI
- Unterstützt `int`, `float`, `bool`, `string`
- Live-Updates über `stateChange`
- Zyklisches Schreiben nach InfluxDB
- Verbindungsstatus (`info.connection`)
- Sauberes Start-/Stop-/Restart-Verhalten
- Unterstützung für **bis zu 20 benutzerdefinierte Sensoren**

---

### Konfiguration

#### InfluxDB
| Feld | Beschreibung |
|-----|--------------|
| URL | InfluxDB Basis-URL |
| Organization | InfluxDB Organisation |
| Bucket | Ziel-Bucket |
| Token | API-Token |
| Polling-Intervall | Schreibintervall in Sekunden |

#### Sensoren
Ein Sensor besteht aus:
- Aktiviert
- Sensorname
- ioBroker-Quell-State
- Datentyp
- Measurement
- Field

Nur aktivierte Sensoren werden verarbeitet.

---

### Laufzeitverhalten
1. Adapter startet
2. InfluxDB-Verbindung wird geprüft
3. Sensor-Datenpunkte werden angelegt oder aktualisiert
4. Fremde States werden abonniert
5. Änderungen aktualisieren den internen Cache
6. Cache wird zyklisch nach InfluxDB geschrieben

---

### Entwicklerhinweise
- Adapter nutzt **Compact Mode**
- `extendObject()` aktualisiert bestehende States
- Interner Cache reduziert Zugriffe
- Sauberes Unload-Handling
- Reines JavaScript (kein TypeScript zur Laufzeit)

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
### 0.1.2 (2026-01-14)
* (patricknitsch) change UI to look for Source in Tree

### 0.1.1 (2026-01-14)
* (patricknitsch) add more Debugging
* (patricknitsch) optimize translation

### 0.1.0 (2026-01-14)
* (patricknitsch) initial release

## License