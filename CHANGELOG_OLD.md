# Older changes
## 1.8.4 (2026-05-23)
* (patricknitsch) Fix missing unit in Formula-Engine

## 1.8.3 (2026-05-21)
* (copilot) Modify notification manager to work with instances
* (copilot) Update Dependencies

## 1.8.2 (2026-05-03)
* (copilot) Adapter requires node.js >= 22 now
* (copilot) Fix sensor duplicate: stale draft cache caused wrong sensor data to appear in the detail panel after duplicating or deleting a sensor
* (copilot) Update Dependencies

## 1.8.1 (2026-04-25)

* (copilot) Auto-detect sensor unit from ioBroker state `common.unit`; unit field configurable in Expert Mode; display defaults to `W` when no unit is set
* (copilot) Update Documentation

## 1.8.0 (2026-04-24)

* (copilot) Update Dependencies
* (copilot) Add Notification function, to send warnings and errors to selectable providers
* (copilot) Update Documentation

## 1.7.1 (2026-04-11)

* (patricknitsch) Default for max Values with 0W deactivated
* (patricknitsch) Fix non-expert information when monitoring is disabled

## 1.7.0 (2026-04-10)

* (patricknitsch) Increased max value from 10.000W to 15.000W
* (copilot) Zero-value alive monitoring: when a sensor timeout fires and the current value is 0, log info instead of warn and retry after 60 minutes
* (copilot) Sensor overview: numeric value row shows current value with unit (W) left-aligned and max value with unit (W) right-aligned
* (copilot) Sensor overview: timestamp row shows last timestamp left-aligned and auto-computed next expected update timestamp right-aligned (no manual input needed)
* (copilot) Sensor overview: change Format

## 1.6.0 (2026-04-06)

* (patricknitsch) Catch max. Values - settable in Config
* (patricknitsch) Increase Version from 20 to 24 becauso of deploy error
* (copilot) Add Alive monitoring: configurable timeout warns when sensor values are not updated

## 1.5.0 (2026-03-21)

* (patricknitsch) Fix Issues RepoChecker
* (copilot) Add Tab for SOLECTRUS iFrame

## 1.4.1 (2026-03-18)

* (copilot) Update Tab Format
* (copilot) Update Readme
* (patricknitsch) Update Packages

## 1.4.0 (2026-03-16)

* (copilot) Fix String Handling in Formula Engine
* (copilot) Fix Formula Engine when using state formulas
* (copilot) New Page for smart Sensor Overview
* (patricknitsch) Update Readme and Doc

## 1.3.1 (2026-03-06)

* (claude) Fix DS Tick time budget

## 1.3.0 (2026-03-04)

* (claude) Fix DS Tick time budget
* (patricknitsch) Update Admin Package
* (claude) Change Admin to easy and expert mode
* (claude) Add information in easy mode 
* (claude) Add type json for sending json, i.e. forecast
* (claude) Update Readme

## 1.2.2 (2026-02-24)

* (claude) Synchronize Formal Engine with Repo from Felliglanz
* (claude) Add Warning after first start, if value is negative
* (claude) Add Comment on first page, that SOLECTRUS doesn't accept negative values
* (claude) Update Readme and Translations

## 1.2.1 (2026-02-13)

* (patricknitsch) Fix wrong package

## 1.2.0 (2026-02-13)

* (claude) Concurrent collect and flush without delay of 5s

## 1.1.2 (2026-02-13)

* (patricknitsch) Fix Eslint-Warnings

## 1.1.1 (2026-02-12)

* (patricknitsch) Fix Eslint-Errors

## 1.1.0 (2026-02-12)

* (claude) Add Formula Engine to build own sensors

## 1.0.0 (2026-01-31)

* (patricknitsch) change Config for Encryption -> Credentials must be re-entered

## 0.3.5 (2026-01-30)

* (patricknitsch) Using node:package format
* (patricknitsch) encrypt sensitive information -> Token must be re-entered
* (patricknitsch) onStateChange ignores ack flag
* (patricknitsch) creation of intermediate objects missing
* (patricknitsch) using this.setTimeout
* (patricknitsch) check and limit configurable timeouts/intervals
* (patricknitsch) Extend Readme

## 0.3.4 (2026-01-19)

* (patricknitsch) Update Readme and split it in two own docs

## 0.3.3 (2026-01-19)

* (patricknitsch) Try fixing automatic npm release

## 0.3.2 (2026-01-19)

* (patricknitsch) change Repo from ssh to https

## 0.3.1 (2026-01-19)

* (Felliglanz) Fix some issues in UI

## 0.3.0 (2026-01-18)

* (patricknitsch) Better handling of Influx Connection, also if no sensor is active
* (Felliglanz) Rebuild of UI with actual status of each sensor

## 0.2.0 (2026-01-18)

* (patricknitsch) Refactoring code and improve readability
* (patricknitsch) Buffer values and send to Influx if Influx is online
* (patricknitsch) Save max. 100000 values and send all to Influx if Influx is online again
* (patricknitsch) Split Data Collecting and Influx writing
* (patricknitsch) Updated Translations

## 0.1.5 (2026-01-17)

* (Felliglanz) Improve sensor configuration UI (accordion)

## 0.1.4 (2026-01-15)

* (patricknitsch) Bugfix with Icon

## 0.1.3 (2026-01-15)

* (patricknitsch) Bugfix for License
* (patricknitsch) Bugfix for Interval
* (patricknitsch) Synchronize Names, Measurements and Fields to SOLECTRUS Documentation

## 0.1.2 (2026-01-14)
* (patricknitsch) change UI to look for Source in Tree

## 0.1.1 (2026-01-14)
* (patricknitsch) add more Debugging
* (patricknitsch) optimize translation

## 0.1.0 (2026-01-14)
* (patricknitsch) initial release

[Older changelogs can be found there](CHANGELOG_OLD.md)
