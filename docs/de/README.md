# SOLECTRUS InfluxDB Adapter -- Dokumentation

## Inhaltsverzeichnis

1. [InfluxDB-Konfiguration](#1-influxdb-konfiguration)
2. [Sensoren](#2-sensoren)
3. [Sensoren-Übersicht Tab](#3-sensoren-übersicht-tab)
4. [Prognosequellen](#4-prognosequellen)
5. [How-To: pvForecast mit pvnode](#5-how-to-pvforecast-mit-pvnode)
6. [Data-SOLECTRUS Formel-Engine](#6-data-solectrus-formel-engine)
7. [Item-Modi](#7-item-modi)
8. [Formel-Builder](#8-formel-builder)
9. [State Machine Modus](#9-state-machine-modus)
10. [Data Runtime Einstellungen](#10-data-runtime-einstellungen)
11. [Monitoring & Buffer](#11-monitoring--buffer)
12. [Berechnete Werte als Sensor-Quellen verwenden](#12-berechnete-werte-als-sensor-quellen-verwenden)
13. [Debugging](#13-debugging)
14. [Benachrichtigungen](#14-benachrichtigungen)

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

Am Ende dieses Tabs befinden sich:

- Eine Checkbox zum Aktivieren der **Data-SOLECTRUS** Formel-Engine (siehe Abschnitt 5)
- Eine Checkbox zum Aktivieren des **Expertenmodus** (siehe Abschnitt 2 -- Sensoren)

---

## 2. Sensoren

Zum Tab **Sensors** wechseln. Der Master/Detail-Editor zeigt alle konfigurierten Sensoren mit ihrem Live-Status.

### Standardmodus vs. Expertenmodus

Standardmäßig läuft der Adapter im **Standardmodus**. Die Sensorliste zeigt alle vorkonfigurierten Sensoren (INVERTER_POWER, BATTERY_SOC, HOUSE_POWER, Prognosesensoren usw.). Im Standardmodus:

- **Editierbar**: Source State (ioBroker-Datenpunkt), Aktiviert-Checkbox
- **Nur lesen**: Sensorname, Datentyp, Measurement, Field, JSON-Vorlage
- **Ausgeblendet**: Hinzufügen-, Löschen-, Duplizieren-Buttons, Maximalwert, Alive-Timeout

So wird sichergestellt, dass Anfänger einfach Sensoren aktivieren und Quell-States zuweisen können, ohne versehentlich das InfluxDB-Mapping zu ändern. Im Standardmodus gelten folgende Standardwerte: **Werteüberwachung deaktiviert** (Maximalwert = 0) und **60 Minuten** Alive-Timeout. Die genaue Konfiguration ist im Expertenmodus möglich.

Für volle Kontrolle den **Expertenmodus** auf der InfluxDB-Einstellungsseite aktivieren. Im Expertenmodus:

- Alle Felder sind editierbar
- Sensoren können hinzugefügt, gelöscht, dupliziert und umsortiert werden
- JSON-Vorlagen können auf Benutzerdefiniert umgestellt werden

### Sensor-Einstellungen

Die folgende Tabelle zeigt alle konfigurierbaren Felder pro Sensor. Im **Expertenmodus** sind alle Felder editierbar, und Sensoren können hinzugefügt, gelöscht und umsortiert werden.

Auf **Add** klicken (Expertenmodus) oder einen bestehenden Sensor auswählen und konfigurieren:

| Einstellung | Beschreibung | Modus |
|-------------|--------------|-------|
| Enabled | Sensor aktivieren/deaktivieren | Standard + Experte |
| ioBroker Source State | Quell-Datenpunkt. Mit **Select** den Objektbaum durchsuchen. | Standard + Experte |
| Sensor Name | Anzeigename (wird auch für die ioBroker State-ID unter `sensors.*` verwendet) | Experte |
| Maximalwert in W | Sensor-spezifischer Plausibilitätswert. Bei Überschreitung wird der letzte gültige Wert gesendet und eine Warnung ausgegeben. **0 = deaktiviert** (Standard). | Experte |
| Alive-Timeout (min, 0 = deaktiviert) | Wenn innerhalb dieser Zeitspanne kein neuer Wert empfangen wird: bei einem **Wert ungleich 0** wird eine Warnung ins Log geschrieben und der Zeitstempel im Übersicht-Tab **orange** markiert; bei einem **Wert von 0** wird stattdessen eine Info-Meldung ausgegeben und der nächste Prüfzyklus erst nach **60 Minuten** durchgeführt. **0 = deaktiviert**. Standard: `60`. Muss größer sein als das Aktualisierungsintervall des Quelladapters. | Experte |
| Datatype | `int`, `float`, `bool`, `string` oder `json` (JSON-Array) | Experte |
| Influx Measurement | InfluxDB Measurement-Name (z.B. `inverter`) | Experte |
| Influx Field | InfluxDB Feldname (z.B. `power`) | Experte |

Mindestens ein Sensor muss aktiviert sein, damit Daten geschrieben werden.

### JSON-Sensoren (Prognosedaten)

Für Prognose-/Wetterdaten den Datentyp auf **JSON-Array** setzen. Zwei Vorlage-Modi sind verfügbar:

| Modus | Beschreibung |
|-------|--------------|
| **Automatisch** | Erkennt bekannte Felder in den JSON-Daten (`y`, `clearsky`, `temp`) automatisch und schreibt jedes in das korrekte InfluxDB-Measurement/Field. Ein Sensor verarbeitet alle erkannten Prognosetypen. |
| **Benutzerdefiniert** | Zeitstempel-Feld, Wert-Feld und InfluxDB-Typ manuell festlegen. Für nicht-standardmäßige JSON-Quellen verwenden. |

**Automatische Erkennung:**

| JSON-Feld | InfluxDB Measurement | InfluxDB Field | Typ |
|-----------|---------------------|----------------|-----|
| `y` | `forecast` | `watt` | int |
| `clearsky` | `forecast` | `watt_clearsky` | int |
| `temp` | `forecast` | `temp` | float |

Felder, die im JSON nicht vorhanden sind, werden automatisch übersprungen.

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

### Maximalwert-Validierung

Jeder numerische Sensor (`int`, `float` oder Standardtyp) unterstützt ein **Maximalwert in W**-Feld (im Expertenmodus konfigurierbar). Wird dieser Wert überschritten:

1. Es wird eine Warnung ins Log geschrieben: `Sensor "..." delivers implausible value (X > max Y). Using last valid value (Z) instead.`
2. Stattdessen wird der **zuletzt gültige Wert** (der zuletzt gemessene Wert unterhalb des Limits) an InfluxDB gesendet.
3. Falls noch kein gültiger Wert vorliegt, wird der Datenpunkt vollständig übersprungen.

Dadurch werden kurzzeitige Sensor-Ausreißer (z.B. kurze Burst-Lesungen von 99999 W) verhindert, die die Zeitreihendaten verfälschen würden.

Der Standardwert ist **0 (deaktiviert)** – die Werteüberwachung ist für neue Sensoren standardmäßig ausgeschaltet. Im Expertenmodus kann für jeden Sensor ein individuelles Limit gesetzt werden (z.B. `15000` W oder `5000` W für einen Zweitwechselrichter). Ist der Maximalwert auf `0` gesetzt, wird die Werteüberwachung für diesen Sensor deaktiviert.

### Field-Type-Konflikte

Meldet InfluxDB einen Field-Type-Konflikt (z.B. Float in ein bestehendes Int-Feld schreiben), wird der betroffene Sensor automatisch deaktiviert und der Buffer geleert.

---

## 3. Sensoren-Übersicht Tab

Der Tab **SOLECTRUS Overview** (erreichbar über die Tab-Leiste im Adapter-Bereich) zeigt in Echtzeit alle konfigurierten und aktiven Sensoren und Datenpunkte auf einen Blick.

![Sensor-Übersicht Beispiel](../img/sensor-overview.svg)

### Funktionen

- **InfluxDB-Sensoren Raster**: Zeigt alle aktivierten Sensoren als kompakte Karten in einem responsiven Raster. Jede Karte zeigt:
  - **Sensorname** und **Datentyp-Badge** (`int`, `float`, `bool`, `string`, `json`)
  - **Wert-Zeile** (nur numerische Sensoren): linksbündig **aktueller Wert mit Einheit** (z.B. `2697 W`); rechtsbündig **Maximalwert mit Einheit** als Badge – wird nur angezeigt, wenn der Maximalwert > 0 (Werteüberwachung aktiv). Zeigt *k.A.* an, wenn noch kein Wert empfangen wurde. JSON-Werte werden kompakt in Monospace-Schrift dargestellt.
  - **Measurement: Field** — das Ziel in InfluxDB (getrennt durch einen Doppelpunkt)
  - **Quell-State** — die gelesene ioBroker-State-ID (gekürzt, voller Pfad als Tooltip)
  - **Zeitstempel-Zeile** (wird nur angezeigt, wenn ein Alive-Timeout konfiguriert ist): linksbündig **Zeitstempel** (Datum und Uhrzeit der letzten Wertaktualisierung); rechtsbündig **nächste erwartete Aktualisierung** als Badge (nur Uhrzeit, ohne Beschriftung, automatisch berechnet als Zeitstempel + Timeout-Intervall – keine manuelle Eingabe nötig). Bei einem aktuellen Wert von 0 wird das 60-Minuten-Fallback-Intervall für die Berechnung verwendet. Die Zeile wird **orange** dargestellt, wenn der Alive-Timeout überschritten wurde.
- **Formel-Engine Raster** (wird nur angezeigt, wenn Data-SOLECTRUS aktiviert ist): Zeigt alle aktiven berechneten Items in der gleichen Kartendarstellung mit Modus-Badge, aktuellem Wert, State-ID und Formel/Ausdruck. Schriftgrößen bleiben in allen Gerätedrehungen konstant.
- **JSON-Array Vorschau**: Bei Sensoren mit Datentyp `json` zeigt der Wert den **ersten Array-Eintrag** gefolgt von der Anzahl weiterer Einträge (z.B. `{"t":1710000000000,"y":1250} (+543 weitere Einträge)`).
- **Automatische Aktualisierung**: Der Tab aktualisiert sich alle 5 Sekunden selbstständig.
- **Layout-Umschalter**: Die Schaltfläche **Ganze Breite** / **Flexibel** in der Toolbar wechselt beide Raster zwischen einem flexiblen Mehrspalten-Layout und einem einspaltigem Vollbreiten-Layout. Die Auswahl wird im Browser gespeichert und beim nächsten Besuch wiederhergestellt.

### Navigation

Auf **Konfiguration öffnen** (oben rechts) klicken, um direkt zur Instanzkonfiguration dieses Adapters zu gelangen.

---

## 4. Prognosequellen

Prognose- und Wetterdaten von pvforecast oder ähnlichen Adaptern können mit **JSON-Sensoren** im Tab Sensoren nach InfluxDB geschrieben werden. Einfach den Datentyp auf **JSON-Array** setzen und die Vorlage **Automatisch** verwenden.

### Funktionsweise

1. Der Adapter abonniert einen oder mehrere JSON-States (z.B. `pvforecast.0.summary.JSONData`)
2. Wenn sich der JSON-State ändert, parst der Adapter das JSON-Array
3. Im **Automatik**-Modus durchsucht der Adapter jeden Eintrag nach bekannten Wert-Feldern (`y`, `clearsky`, `temp`)
4. Für jedes erkannte Feld wird ein Datenpunkt mit dem korrekten Measurement, Field und Typ in InfluxDB geschrieben
5. Da InfluxDB Punkte mit gleichem Measurement, Tags und Zeitstempel überschreibt, werden **bestehende Prognosepunkte automatisch aktualisiert**, wenn sich die Quelldaten ändern

### JSON-Format

Der Quell-State muss ein JSON-Array von Objekten enthalten. Jedes Objekt muss ein Zeitstempel-Feld (`t`) und ein oder mehrere Wert-Felder haben:

```json
[
  { "t": 1709035200000, "y": 1500, "clearsky": 2000, "temp": 12.5 },
  { "t": 1709038800000, "y": 2200, "clearsky": 2800, "temp": 14.0 }
]
```

### Vorkonfigurierte Prognosesensoren

Der Adapter enthält drei vorkonfigurierte Prognosesensoren:

| Sensor | Measurement | Field | Typ | JSON-Feld |
|--------|-------------|-------|-----|-----------|
| INVERTER_POWER_FORECAST | `forecast` | `watt` | int | `y` |
| INVERTER_POWER_FORECAST_CLEARSKY | `forecast` | `watt_clearsky` | int | `clearsky` |
| OUTDOOR_TEMP_FORECAST | `forecast` | `temp` | float | `temp` |

Im **Automatik**-Modus erkennt ein einzelner JSON-Sensor alle vorhandenen Felder und schreibt sie automatisch. Du musst nur einen Sensor aktivieren und auf den JSON-Quell-State zeigen.

### Zeitstempel-Behandlung

- **Millisekunden** (Zahl >= 10^12): Direkt verwendet
- **Sekunden** (Zahl < 10^12): Automatisch in Millisekunden umgerechnet
- **ISO-String**: Geparst über `Date`-Konstruktor

---

## 5. How-To: pvForecast mit pvnode

Dieser Abschnitt erklärt, wie der **pvforecast**-Adapter mit SOLECTRUS InfluxDB für Prognosedaten verbunden wird.

### Voraussetzungen

- ioBroker mit installiertem pvforecast-Adapter
- SOLECTRUS InfluxDB-Adapter installiert und mit InfluxDB verbunden

### Schritt 1: pvforecast-Backend wählen

Der pvforecast-Adapter unterstützt zwei Backends:

| Backend | Verfügbare Felder | Beschreibung |
|---------|-------------------|--------------|
| **Standard** | `y` (Prognoseleistung) | Nur einfache PV-Leistungsprognose |
| **pvnode: ab V6.0.0** | `y`, `clearsky`, `temp` | Vollständige Prognose mit Clearsky-Einstrahlung und Temperatur |

> **Wichtig:** Die Felder `clearsky` (watt_clearsky) und `temp` sind **nur mit pvnode** als Backend verfügbar. Das Standard-pvForecast-Backend liefert nur das Feld `y` (Prognoseleistung).

### Schritt 2: pvforecast konfigurieren

1. pvforecast-Adapter in ioBroker installieren
2. PV-Anlagenparameter konfigurieren (Standort, Module, Ausrichtung usw.)
3. Wenn Clearsky- und Temperatur-Daten gewünscht sind, **pvnode** als Backend konfigurieren
4. Prüfen, dass `pvforecast.0.summary.JSONData` ein JSON-Array mit Prognosedaten enthält

### Schritt 3: JSON-Sensor in SOLECTRUS InfluxDB aktivieren

1. SOLECTRUS InfluxDB Adapter-Einstellungen öffnen
2. Zum Tab **Sensoren** wechseln
3. Den Sensor **INVERTER_POWER_FORECAST** (oder einen anderen Prognosesensor) finden
4. Den **ioBroker Source State** auf `pvforecast.0.summary.JSONData` setzen
5. Den Sensor aktivieren (Checkbox)
6. Konfiguration speichern

Der Adapter erkennt automatisch alle verfügbaren Felder in den JSON-Daten und schreibt sie nach InfluxDB:

- `y` -> `forecast.watt` (immer verfügbar)
- `clearsky` -> `forecast.watt_clearsky` (nur pvnode)
- `temp` -> `forecast.temp` (nur pvnode)

### Schritt 4: In InfluxDB prüfen

Nach dem nächsten pvforecast-Update den InfluxDB-Bucket auf das Measurement `forecast` prüfen. Die Felder `watt` und, bei Verwendung von pvnode, auch `watt_clearsky` und `temp` sollten sichtbar sein.

### Fehlerbehebung

- **Keine Daten geschrieben**: Sicherstellen, dass der Sensor aktiviert ist und der Source-State ein gültiges JSON-Array enthält
- **Nur Feld `watt`**: Das pvforecast-Backend ist nicht pvnode. Auf pvnode wechseln für zusätzliche Felder
- **Zeitstempel falsch**: Prüfen, dass die JSON-Daten Unix-Zeitstempel (Sekunden oder Millisekunden) oder ISO-Strings verwenden

---

## 6. Data-SOLECTRUS Formel-Engine

Die Formel-Engine ist ein optionales Feature zur Berechnung abgeleiteter Werte aus beliebigen ioBroker-States. Aktivierung über die Checkbox **Data-SOLECTRUS aktivieren (Formel-Engine)** im InfluxDB-Tab.

Bei Aktivierung erscheinen zwei zusätzliche Tabs:

- **Data Values** -- Berechnete Items konfigurieren
- **Data Runtime** -- Globale Polling- und Snapshot-Einstellungen

### Konzepte

- **Items** sind die Bausteine. Jedes Item liest einen oder mehrere ioBroker-States und erzeugt einen Ausgabe-State unter `solectrus-influxdb.X.ds.*`
- Items können in drei Modi betrieben werden: **Source**, **Formula** oder **State Machine**
- Items lassen sich in **Ordner/Gruppen** organisieren
- Berechnete Werte können als Sensor-Quellen für die InfluxDB-Speicherung verwendet werden

---

## 7. Item-Modi

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

## 8. Formel-Builder

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

## 9. State Machine Modus

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

## 10. Data Runtime Einstellungen

Im Tab **Data Runtime**:

| Einstellung | Beschreibung | Standard |
|-------------|--------------|----------|
| Poll interval (seconds) | Wie oft berechnete Items neu ausgewertet werden | 5 |
| Read inputs on tick (snapshot) | Alle Input-States bei jedem Auswertungszyklus frisch lesen | aus |
| Snapshot delay (ms) | Wartezeit nach Snapshot-Lesen vor der Auswertung | 0 |

---

## 11. Monitoring & Buffer

### Alive-Monitoring

Der Adapter überwacht automatisch, ob Sensorwerte noch regelmäßig aktualisiert werden. Das Feld **Alive-Timeout (min, 0 = deaktiviert)** ist im **Expertenmodus** individuell für jeden Sensor konfigurierbar (Standard: 60 Minuten). Ist der Timeout auf `0` gesetzt, wird die Alive-Überwachung für diesen Sensor vollständig deaktiviert – die Zeitstempel-Zeile wird in der Sensorübersicht ausgeblendet.

Erhält ein Sensor länger als den konfigurierten Timeout keinen neuen Wert, gibt der Adapter eine Warnung aus:

```
Sensor "INVERTER_POWER": no update since 4/5/2026, 6:30:00 PM (longer than 60 minute(s))
```

Zusätzlich wird der letzte Zeitstempel des betroffenen Sensors im **Tab** in **orange** angezeigt, sodass du veraltete Sensoren auf einen Blick erkennst, ohne das Log zu öffnen.

Die Warnung wird pro Sensor höchstens einmal pro Timeout-Periode wiederholt, damit das Log nicht überflutet wird. Setze den Timeout auf `0`, um die Prüfung für einen einzelnen Sensor zu deaktivieren (nur im Expertenmodus). Neu angelegte Sensoren haben standardmäßig einen Timeout von `60` Minuten. Der Timeout muss größer sein als das Aktualisierungsintervall des jeweiligen Quelladapters.

### Werteüberwachung (Maximalwert)

Die Werteüberwachung ist standardmäßig **deaktiviert** (Maximalwert = 0). Im **Expertenmodus** kann für jeden numerischen Sensor ein individueller Maximalwert in W gesetzt werden. Ist der Maximalwert > 0, wird er als Badge neben dem aktuellen Wert in der Sensorübersicht angezeigt. Bei deaktivierter Werteüberwachung (Maximalwert = 0) wird der Badge ausgeblendet.

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

## 12. Berechnete Werte als Sensor-Quellen verwenden

Data-SOLECTRUS berechnete Werte können als Sensor-Input für die InfluxDB-Speicherung genutzt werden:

1. Berechnetes Item (Source, Formula oder State Machine) im Tab **Data Values** anlegen
2. Im Tab **Sensors** einen neuen Sensor hinzufügen
3. Als **ioBroker Source State** den berechneten Wert auswählen: `solectrus-influxdb.X.ds.<outputId>`
4. Measurement, Field und Datentyp wie gewohnt konfigurieren

Der Adapter regelt die Initialisierungsreihenfolge automatisch -- Sensor-Abonnements für `ds.*`-States funktionieren auch wenn die Formel-Engine nach dem Sensor-Setup startet.

---

## 13. Debugging

Loglevel des Adapters auf **Debug** setzen für detaillierte Ausgaben zu:

- Sensorwert-Erfassung
- InfluxDB-Schreiboperationen
- Formelauswertungs-Details
- State Machine Regelabgleich
- Buffer-Operationen

---

## 14. Benachrichtigungen

Der Adapter kann bei wichtigen Ereignissen Meldungen über konfigurierbare Benachrichtigungsanbieter senden.

### Aktivierung

Im Tab **Benachrichtigungen** der Adapter-Einstellungen:

1. Checkbox **Enable notifications** aktivieren
2. Gewünschte Ereignisse auswählen
3. Mindestens einen Benachrichtigungsanbieter konfigurieren

### Auslöser

| Ereignis | Beschreibung |
|----------|--------------|
| **InfluxDB connection failure / restore** | Wird beim ersten Verbindungsfehlschlag gesendet sowie bei Wiederherstellung der Verbindung |
| **Sensor alive timeout** | Wird gesendet, wenn ein Sensor innerhalb des konfigurierten Timeouts keine Aktualisierung liefert (nur bei Nicht-Null-Werten) |
| **Max value exceeded** (`notifyOnMaxValueExceeded`) | Wird gesendet, wenn ein Sensor den konfigurierten Maximalwert überschreitet; gedrosselt auf max. 1×/Stunde je Sensor |

### Unterstützte Anbieter

| Anbieter | Voraussetzung |
|---------|---------------|
| **Telegram** | ioBroker Telegram-Adapter installiert und konfiguriert |
| **Pushover** | ioBroker Pushover-Adapter installiert und konfiguriert |
| **WhatsApp** | ioBroker whatsapp-cmb-Adapter installiert und konfiguriert |
| **Email** | ioBroker Email-Adapter installiert und konfiguriert |
| **Signal** | ioBroker signal-cmb-Adapter installiert und konfiguriert |
| **Matrix** | ioBroker matrix-org-Adapter installiert und konfiguriert |
| **Synology Chat** | ioBroker synochat-Adapter installiert und konfiguriert |

Mehrere Anbieter können gleichzeitig konfiguriert werden. Der Adapter prüft vor dem Senden, ob die jeweilige Adapterinstanz aktiv ist, und gibt bei inaktiver Instanz eine Warnung ins Log.

### Hinweise

- Die Benachrichtigungen werden über `getNotificationMessage()` anhand der `systemLanguage` lokalisiert gesendet.
- Bei InfluxDB-Verbindungsfehlern wird eine Benachrichtigung gesendet; bei anhaltenden Problemen kann sie nach `notifyRepeatMinutes` erneut gesendet werden.
- Sensor-Timeout-Benachrichtigungen setzen das konfigurierte Alive-Timeout (Expertenmodus) voraus und sind zusätzlich über `notifyRepeatMinutes` gedrosselt.
