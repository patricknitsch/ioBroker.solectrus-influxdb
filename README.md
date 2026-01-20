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

## Documentation

[🇺🇸 Documentation](./docs/en/README.md)

[🇩🇪 Dokumentation](./docs/de/README.md)

---

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 0.3.4 (2026-01-19)

* (patricknitsch) Update Readme and split it in two own docs

### 0.3.3 (2026-01-19)

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

MIT License

Copyright (c) 2026 patricknitsch <patricknitsch@web.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
