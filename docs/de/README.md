
# 🚀 Schnellstart – Adapter verwenden

## Schritt-für-Schritt Einrichtung

### 1️⃣ Adapter installieren
Installiere den **SOLECTRUS InfluxDB Adapter** über die ioBroker Admin-Oberfläche.

### 2️⃣ InfluxDB-Daten eintragen
Adapter → **InfluxDB Tab**

| Feld | Beschreibung |
|------|--------------|
| `URL` | Adresse des InfluxDB 2.x Servers |
| `Organization` | Deine Organisation |
| `Bucket` | Ziel-Bucket |
| `Token` | API-Token mit Schreibrechten |

Der Adapter prüft die Verbindung mit einem Test-Write.

### 3️⃣ Sensoren konfigurieren
Im Tab **Sensors**:

| Einstellung | Beschreibung |
|------------|--------------|
| `Enabled` | Sensor aktivieren |
| `Sensor Name` | Anzeigename |
| `ioBroker Source State` | Bestehenden Datenpunkt auswählen |
| `Datatype` | int / float / bool / string |
| `Measurement` | Influx Measurement |
| `Field` | Influx Feldname |

➡ Mindestens ein Sensor muss aktiviert sein.

### 4️⃣ Speichern & Adapter starten
Nach dem Speichern:
- Adapter abonniert die Datenpunkte
- Zustände erscheinen unter  
  `solectrus-influxdb.X.sensors.*`

### 5️⃣ Datensammlung
Der Adapter:
1. Liest Sensorwerte  
2. Speichert sie im Puffer  
3. Schreibt sie gesammelt nach InfluxDB  

### 6️⃣ Wenn InfluxDB nicht erreichbar ist
Es gehen keine Daten verloren:
- Werte bleiben im Buffer  
- Automatische Wiederholungsversuche  
- Nach Wiederverbindung werden alle Werte übertragen  

### 7️⃣ Überwachung

| Zustand | Bedeutung |
|--------|-----------|
| `info.connection` | Verbindung zu InfluxDB |
| `info.buffer.size` | Anzahl gepufferter Punkte |
| `info.buffer.oldest` | Ältester gespeicherter Zeitstempel |
| `info.lastError` | Letzter kritischer Fehler |

### 8️⃣ Buffer manuell löschen

State:
`solectrus-influxdb.X.info.buffer.clear`

Button drücken → Buffer wird geleert.

## Debugging

Loglevel auf Debug setzen.

---