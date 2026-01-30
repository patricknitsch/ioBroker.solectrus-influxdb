
# 🚀 Getting Started – How to use the Adapter

## Step-by-Step Setup

### 1️⃣ Install the adapter
Install **SOLECTRUS InfluxDB Adapter** via the ioBroker admin interface.

### 2️⃣ Enter InfluxDB connection data
Open the adapter configuration → **InfluxDB** tab and fill in:

| Field | Description |
|------|-------------|
| `URL` | InfluxDB 2.x server address |
| `Organization` | Your InfluxDB organization |
| `Bucket` | Target bucket |
| `Token` | API token with write permissions |

The adapter verifies the connection by writing a test point.

### 3️⃣ Configure Sensors
Go to the **Sensors** tab.

For each sensor:

| Setting | Description |
|--------|-------------|
| `Enabled` | Activate the sensor |
| `Sensor Name` | Display name |
| `ioBroker Source State` | Select an existing ioBroker state |
| `Datatype` | int / float / bool / string |
| `Measurement` | Influx measurement name |
| `Field` | Influx field name |

➡ You must enable at least one sensor or no data will be written.

### 4️⃣ Save & Start Adapter
After saving:
- Adapter subscribes to the selected states  
- States are mirrored under:  
  `solectrus-influxdb.X.sensors.*`

### 5️⃣ Data Collection
The adapter now:
1. Reads values from configured sensors  
2. Stores them in an internal buffer  
3. Writes them to InfluxDB in batches  

### 6️⃣ If InfluxDB is offline
No data is lost:
- Values stay in the buffer
- Adapter retries automatically
- Buffered values are written after reconnection

### 7️⃣ Monitoring

| State | Meaning |
|------|--------|
| `info.connection` | InfluxDB reachable |
| `info.buffer.size` | Number of stored points |
| `info.buffer.oldest` | Oldest buffered timestamp |
| `info.lastError` | Last critical issue |

### 8️⃣ Manual Buffer Clear

State:
`solectrus-influxdb.X.info.buffer.clear`

Pressing the button deletes the buffer.

### Debugging

Set log level to Debug for detailed information.

---