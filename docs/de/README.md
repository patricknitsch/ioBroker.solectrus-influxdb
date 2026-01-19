# ioBroker.solectrus-influxdb

# 🌞 SOLECTRUS InfluxDB Adapter für ioBroker

---

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
