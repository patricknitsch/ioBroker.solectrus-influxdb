# SOLECTRUS InfluxDB Adapter -- Dokumentation

## Inhaltsverzeichnis

1. [InfluxDB-Konfiguration](#1-influxdb-konfiguration)
2. [Sensoren](#2-sensoren)
3. [Prognosequellen](#3-prognosequellen)
4. [Data-SOLECTRUS Formel-Engine](#4-data-solectrus-formel-engine)
5. [Item-Modi](#5-item-modi)
6. [Formel-Builder](#6-formel-builder)
7. [State Machine Modus](#7-state-machine-modus)
8. [Data Runtime Einstellungen](#8-data-runtime-einstellungen)
9. [Monitoring & Buffer](#9-monitoring--buffer)
10. [Berechnete Werte als Sensor-Quellen verwenden](#10-berechnete-werte-als-sensor-quellen-verwenden)
11. [Debugging](#11-debugging)

---

## 1. InfluxDB-Konfiguration

Adapter-Einstellungen öffnen und zum Tab **InfluxDB** wechseln.

| Feld | Beschreibung |
|------|--------------|
| URL | InfluxDB 2.x Server-Adresse (z.B. `http://192.168.1.10:8086`) |
| Organization | Deine InfluxDB-Organisation |
| Bucket | Ziel-Bucket für Zeitreihendaten |
| Token | API-Token mit **Schreibrechten** |
| Polling Interval (s) | Wie oft Sensorwerte gesammelt werden (5-30 Sekunden) |

Der Adapter prüft die Verbindung beim Start durch Schreiben eines Test-Punktes. Der Verbindungsstatus wird in `info.connection` angezeigt.

Am Ende dieses Tabs befindet sich eine Checkbox zum Aktivieren der **Data-SOLECTRUS** Formel-Engine (siehe Abschnitt 3).

---

## 2. Sensoren

Zum Tab **Sensors** wechseln. Der Master/Detail-Editor zeigt alle konfigurierten Sensoren mit ihrem Live-Status.

### Sensor hinzufügen

Auf **Add** klicken und konfigurieren:

| Einstellung | Beschreibung |
|-------------|--------------|
| Enabled | Sensor aktivieren/deaktivieren |
| Sensor Name | Anzeigename (wird auch für die ioBroker State-ID unter `sensors.*` verwendet) |
| ioBroker Source State | Quell-Datenpunkt. Mit **Select** den Objektbaum durchsuchen. |
| Datatype | `int`, `float`, `bool` oder `string` |
| Influx Measurement | InfluxDB Measurement-Name (z.B. `INVERTER_POWER`) |
| Influx Field | InfluxDB Feldname (z.B. `value`) |

Mindestens ein Sensor muss aktiviert sein, damit Daten geschrieben werden.

### Funktionsweise

1. Der Adapter abonniert den Quell-Datenpunkt jedes Sensors
2. Werte werden unter `solectrus-influxdb.X.sensors.*` gespiegelt
3. In jedem Polling-Intervall werden aktuelle Werte in den Schreibpuffer aufgenommen (**Collect**)
4. Direkt nach dem Collect wird der Puffer an InfluxDB gesendet (**Flush**)

### Collect & Flush Architektur

Collect und Flush laufen nahezu gleichzeitig, ohne sich gegenseitig zu blockieren:

1. **Collect** sammelt alle Sensorwerte und schreibt sie in den Buffer
2. **Sofort-Flush** -- nach dem Collect wird der Flush im nächsten Event-Loop-Tick ausgelöst (kein zusätzliches Warte-Intervall)
3. **Snapshot-and-Swap** -- beim Start des Flush wird der aktuelle Buffer als Batch entnommen und durch ein leeres Array ersetzt. Während der Flush-Vorgang auf die InfluxDB-Antwort wartet, schreibt ein paralleler Collect bereits in den neuen (leeren) Buffer. Der Batch wird dabei nicht verändert.
4. **Fehlerfall** -- schlägt der Flush fehl, wird der Batch chronologisch korrekt wieder vor den aktuellen Buffer gestellt. Es gehen keine Werte verloren.
5. **Überlappungsschutz** -- ein `isFlushing`-Guard verhindert, dass mehrere Flush-Vorgänge gleichzeitig laufen

### NaN-Schutz

Ungültige Werte (`NaN` bei int/float, `null`/`undefined` bei Strings) werden automatisch übersprungen und im Log gewarnt.

### Negative Werte

SOLECTRUS akzeptiert keine negativen Werte. Liefert ein Sensor nach dem Adapterstart einen negativen Wert, wird **einmalig** eine Warnung im Log ausgegeben. Die Werte werden trotzdem an InfluxDB gesendet, können dort aber zu fehlerhaften Auswertungen führen. Abhilfe: Quell-Datenpunkte prüfen oder die Data-SOLECTRUS Formel-Engine mit der Option **Negative Werte auf 0 begrenzen** (Clamp negative to 0) verwenden.

### Field-Type-Konflikte

Meldet InfluxDB einen Field-Type-Konflikt (z.B. Float in ein bestehendes Int-Feld schreiben), wird der betroffene Sensor automatisch deaktiviert und der Buffer geleert.

---

## 3. Prognosequellen

Der Tab **Forecast** ermöglicht es, ganze Ordner mit stündlichen Prognosewerten (z.B. vom pvforecast-Adapter) zu erfassen und mit korrekten Zeitstempeln in die InfluxDB zu schreiben.

### Funktionsweise

1. pvforecast (oder ähnliche Adapter) speichert stündliche Prognosewerte in einer Baumstruktur:
   ```
   pvforecast.0.summary.power.hoursToday.11:00:00     → 1500
   pvforecast.0.summary.power.hoursTomorrow.11:00:00   → 1200
   pvforecast.0.summary.power.hoursDay3.11:00:00       → 900
   ```
2. Jeder Ordner (hoursToday, hoursTomorrow, etc.) repräsentiert einen Tag
3. Jeder State-Name (11:00:00) repräsentiert die Uhrzeit
4. Der Adapter liest **alle** States in jedem aktivierten Ordner und leitet den korrekten UTC-Zeitstempel aus dem Tagesversatz des Ordners + dem State-Namen ab

### Konfiguration

Auf **Add** oder **Add Template** klicken um eine Prognosequelle anzulegen:

| Einstellung | Beschreibung |
|-------------|--------------|
| Name | SOLECTRUS Sensorname (z.B. `INVERTER_POWER_FORECAST`) |
| Basispfad | Objektbaum-Wurzel (z.B. `pvforecast.0.summary.power`) |
| Influx Measurement | InfluxDB Measurement-Name |
| Influx Field | InfluxDB Feldname |
| Datentyp | `int` oder `float` |
| Prognose-Intervall (s) | Wie oft Prognosedaten gesammelt werden (60-3600s, Standard 900 = 15 Min) |

### Ordner

Auf **Ordner scannen** klicken um Unterordner des Basispfades automatisch zu erkennen. Jeder Ordner kann einzeln aktiviert/deaktiviert werden und erhält einen **Tagesversatz**:

| Ordner | Tagesversatz |
|--------|-------------|
| hoursToday | 0 (heute) |
| hoursTomorrow | 1 (morgen) |
| hoursDay3 | 2 (übermorgen) |
| … bis zu 7 Tage mit pvnode | … |

Der Tagesversatz wird automatisch aus dem Ordnernamen erraten, kann aber manuell angepasst werden.

### Vorlagen

Drei vorkonfigurierte Vorlagen stehen zur Verfügung:

| Vorlage | Basispfad | Measurement | Field |
|---------|-----------|-------------|-------|
| INVERTER_POWER_FORECAST | pvforecast.0.summary.power | inverter_forecast | power |
| INVERTER_POWER_FORECAST_CLEARSKY | pvforecast.0.summary.power_clearsky | inverter_forecast_clearsky | power |
| OUTDOOR_TEMP_FORECAST | pvforecast.0.summary.temperature | outdoor_forecast | temperature |

### Sammelverhalten

- Prognosedaten nutzen einen **separaten Timer** (Standard: alle 15 Minuten)
- Werte werden in denselben Buffer wie Sensordaten geschrieben und gemeinsam geflusht
- Jeder gesammelte Wert erhält einen **abgeleiteten Zeitstempel** (nicht `Date.now()` wie bei regulären Sensoren)

---

## 4. Data-SOLECTRUS Formel-Engine

Die Formel-Engine ist ein optionales Feature zur Berechnung abgeleiteter Werte aus beliebigen ioBroker-States. Aktivierung über die Checkbox **Enable Data-SOLECTRUS (formula engine)** im InfluxDB-Tab.

Bei Aktivierung erscheinen zwei zusätzliche Tabs:

- **Data Values** -- Berechnete Items konfigurieren
- **Data Runtime** -- Globale Polling- und Snapshot-Einstellungen

### Konzepte

- **Items** sind die Bausteine. Jedes Item liest einen oder mehrere ioBroker-States und erzeugt einen Ausgabe-State unter `solectrus-influxdb.X.ds.*`
- Items können in drei Modi betrieben werden: **Source**, **Formula** oder **State Machine**
- Items lassen sich in **Ordner/Gruppen** organisieren
- Berechnete Werte können als Sensor-Quellen für die InfluxDB-Speicherung verwendet werden

---

## 5. Item-Modi

### Source-Modus

Spiegelt einen einzelnen ioBroker-State. Optional kann ein Wert aus einem JSON-Payload per JSONPath extrahiert werden.

| Einstellung | Beschreibung |
|-------------|--------------|
| ioBroker Source State | Der zu spiegelnde State |
| JSONPath (optional) | Verschachtelten Wert extrahieren, z.B. `$.apower` |
| Datatype | `number` (Standard), `boolean`, `string` oder `mixed` |
| Clamp negative to 0 | Negative Ausgabewerte durch 0 ersetzen |

### Formula-Modus

Berechnet einen Wert aus mehreren benannten Inputs mittels mathematischem Ausdruck.

| Einstellung | Beschreibung |
|-------------|--------------|
| Inputs | Benannte Variablen, jeweils mit einem ioBroker-Quell-State verknüpft |
| Formula expression | Mathematischer Ausdruck mit den Input-Variablennamen |
| Datatype | Ausgabetyp |
| Clamp / Min / Max | Optionale Ausgabebegrenzung |

**Input-Konfiguration:**

| Feld | Beschreibung |
|------|--------------|
| Key | Variablenname für die Formel (z.B. `pv1`) |
| ioBroker Source State | State, aus dem der Wert gelesen wird |
| JSONPath (optional) | Aus JSON-Payload extrahieren |
| Clamp input negative to 0 | Diesen Input vor der Formelauswertung auf 0 begrenzen |

**Beispielformel:** `pv1 + pv2 + pv3`

### Verfügbare Funktionen

| Funktion | Beschreibung | Beispiel |
|----------|--------------|----------|
| `min(a, b)` | Kleinerer von zwei Werten | `min(5, 10)` = 5 |
| `max(a, b)` | Größerer von zwei Werten | `max(0, wert)` |
| `clamp(v, min, max)` | Wert zwischen Grenzen begrenzen | `clamp(v, 0, 100)` |
| `IF(bed, dann, sonst)` | Bedingung | `IF(soc > 80, überschuss, 0)` |
| `abs(v)` | Absolutwert | `abs(-5)` = 5 |
| `round(v)` | Auf Ganzzahl runden | `round(3.7)` = 4 |
| `floor(v)` / `ceil(v)` | Abrunden / Aufrunden | `floor(3.7)` = 3 |
| `pow(basis, exp)` | Potenz | `pow(2, 3)` = 8 |

### State-Funktionen (erweitert)

Diese Funktionen lesen ioBroker-States direkt in einer Formel, ohne benannte Inputs zu definieren:

| Funktion | Beschreibung | Beispiel |
|----------|--------------|----------|
| `s("id")` | State als sicheren Zahlenwert lesen (0 falls nicht verfügbar) | `s("hm-rpc.0.power") + 100` |
| `v("id")` | State als Rohwert lesen (String/Zahl/Boolean) | `v("mqtt.0.status")` |
| `jp("id", "$.pfad")` | Wert aus JSON-State per JSONPath extrahieren | `jp("shelly.0.json", "$.apower")` |

### Unterstützte Operatoren

`+`, `-`, `*`, `/`, `%`, `()`, `&&`, `||`, `!`, `==`, `!=`, `>=`, `<=`, `>`, `<`, `? :`

---

## 6. Formel-Builder

Neben dem Formel-Eingabefeld auf **Builder...** klicken um den visuellen Formel-Builder zu öffnen.

Der Builder bietet:

- **Variablen (Inputs)** -- Klick fügt benannte Input-Variablen ein
- **Operatoren** -- Klick fügt Operatoren ein, mit Tooltips zur Erklärung
- **Funktionen** -- Funktions-Vorlagen einfügen (`min`, `max`, `clamp`, `IF`)
- **State-Funktionen** -- `s()`, `v()` oder `jp()` mit State-Auswahldialog einfügen
- **Beispiele** -- Häufige Formelmuster (PV-Summe, Überschuss, Prozent, Begrenzung, Bedingungen)
- **Live-Vorschau** -- Formelergebnis in Echtzeit sehen (Adapter muss laufen)

Die Formel ist jederzeit als Klartext editierbar. Der Builder fügt Bausteine nur an der Cursorposition ein.

---

## 7. State Machine Modus

Der State Machine Modus erzeugt String- oder Boolean-States basierend auf Regeln. Regeln werden von oben nach unten ausgewertet; die **erste passende Regel gewinnt**.

Einsatzgebiete:
- Numerische Statuscodes in lesbare Labels übersetzen
- Betriebsmodi anhand mehrerer Sensorwerte bestimmen
- Boolean-Flags aus komplexen Bedingungen erzeugen

### Konfiguration

| Einstellung | Beschreibung |
|-------------|--------------|
| Inputs | Benannte Variablen (wie im Formula-Modus) |
| Datatype | `string` oder `boolean` |
| Rules | Geordnete Liste von Bedingungs-/Ausgabe-Paaren |

### Regeln

Jede Regel hat:

| Feld | Beschreibung |
|------|--------------|
| Condition | Formelausdruck, der als wahr/falsch ausgewertet wird. Input-Variablennamen und Operatoren verwenden. |
| Output Value | Der String- oder Boolean-Wert, der bei passender Bedingung ausgegeben wird. |

**Spezielle Bedingungen:**
- `true` oder leer = Standard/Fallback-Regel (passt immer)
- Input-Variablen und Operatoren verwenden: `soc < 10`, `battery > 80 && surplus > 0`

### Beispiel

Für ein Item mit Inputs `soc` (Batterie-Ladezustand) und `surplus` (PV-Überschuss):

| Bedingung | Ausgabewert |
|-----------|-------------|
| `soc < 10` | `Akku-Leer` |
| `soc < 30` | `Akku-Niedrig` |
| `surplus > 1000 && soc > 80` | `Voll-Export` |
| `true` | `Normal` |

Ergebnis: Der Ausgabe-State enthält `Akku-Leer`, `Akku-Niedrig`, `Voll-Export` oder `Normal` je nach aktuellen Werten.

---

## 8. Data Runtime Einstellungen

Im Tab **Data Runtime**:

| Einstellung | Beschreibung | Standard |
|-------------|--------------|----------|
| Poll interval (seconds) | Wie oft berechnete Items neu ausgewertet werden | 5 |
| Read inputs on tick (snapshot) | Alle Input-States bei jedem Auswertungszyklus frisch lesen | aus |
| Snapshot delay (ms) | Wartezeit nach Snapshot-Lesen vor der Auswertung | 0 |

---

## 9. Monitoring & Buffer

### Adapter-States

| State | Beschreibung |
|-------|--------------|
| `info.connection` | `true` wenn InfluxDB erreichbar |
| `info.buffer.size` | Anzahl gepufferter Datenpunkte |
| `info.buffer.oldest` | Zeitstempel des ältesten gepufferten Punktes |
| `info.buffer.clear` | Button zum manuellen Leeren des Buffers |
| `info.lastError` | Letzte kritische Fehlermeldung |

### Data-SOLECTRUS States (wenn aktiviert)

Berechnete Werte erscheinen unter `solectrus-influxdb.X.ds.*` mit Diagnose-States pro Item.

### Buffer-Verhalten

- Werte werden persistent auf die Festplatte gepuffert (`buffer.json`)
- Maximale Buffer-Größe: 100.000 Punkte
- Der Flush erfolgt **nur bei bestehender InfluxDB-Verbindung** (`ensureInflux()` prüft vor jedem Flush)
- Bei InfluxDB-Ausfall steigen die Wiederholungsintervalle exponentiell (bis 5 Minuten)
- Nach Wiederverbindung werden alle gepufferten Punkte übertragen
- Während eines Flush wird der Buffer nicht verändert (Snapshot-and-Swap Verfahren)
- Bei Flush-Fehler werden die Daten automatisch in den Buffer zurückgestellt

---

## 10. Berechnete Werte als Sensor-Quellen verwenden

Data-SOLECTRUS berechnete Werte können als Sensor-Input für die InfluxDB-Speicherung genutzt werden:

1. Berechnetes Item (Source, Formula oder State Machine) im Tab **Data Values** anlegen
2. Im Tab **Sensors** einen neuen Sensor hinzufügen
3. Als **ioBroker Source State** den berechneten Wert auswählen: `solectrus-influxdb.X.ds.<outputId>`
4. Measurement, Field und Datentyp wie gewohnt konfigurieren

Der Adapter regelt die Initialisierungsreihenfolge automatisch -- Sensor-Abonnements für `ds.*`-States funktionieren auch wenn die Formel-Engine nach dem Sensor-Setup startet.

---

## 11. Debugging

Loglevel des Adapters auf **Debug** setzen für detaillierte Ausgaben zu:

- Sensorwert-Erfassung
- InfluxDB-Schreiboperationen
- Formelauswertungs-Details
- State Machine Regelabgleich
- Buffer-Operationen
