# Thai ID Intake

Secure Thai ID SmartCard intake for a nurse iPad, A01 station display, Windows reader agent, backend coordinator, and Kafka event backbone.

Kafka carries the event flow. The backend owns scan authorization, station queue state, cooldown, and private result routing. The 5-character code is for human confirmation only; the system routes by `requestId + deviceSessionId`.

## Project Structure

```text
thai-id-intake/
  apps/
    backend/          # Scan request API, station queue/state machine, Kafka coordinator
    reader-agent/     # Windows PC/SC SmartCard reader service
    nurse-webapp/     # iPad scan request and private result UI
    station-display/  # A01 display for safe code/status only
  packages/
    shared-types/     # Shared TypeScript contracts and Kafka topic helpers
```

## Current Scan Flow

1. Nurse taps `Scan ID Card` on the iPad.
2. Backend creates a request with `requestId`, `deviceSessionId`, `stationId`, 5-character `turnCode`, and expiry.
3. If the station is busy or cooling down, the request is queued. Queued requests do not burn scan time.
4. Station display shows only the active turn code, queue depth, status, and reader state.
5. Nurse compares the iPad code with the station display code.
6. Reader agent reads the inserted Thai ID card for the active request.
7. Backend validates the active `requestId`, looks up `deviceSessionId`, and publishes the full card result only to that private iPad session.
8. Station moves `delivered -> cooldown` for 3 seconds, then activates the next queued request with a fresh expiry timer or returns to `neutral`.

Station lifecycle:

```text
neutral -> active -> reading -> delivered -> cooldown -> neutral/next queued request
```

Exception states include `queued`, `canceled`, `expired`, `failed`, and `misrouted`.

## Local Kafka

Start Kafka and local Kafka UI:

```powershell
docker compose up -d kafka kafka-ui
```

Apps connect to:

```env
KAFKA_BROKERS=localhost:9092
```

Kafka UI for local testing:

```text
http://localhost:8080
```

`kafbat/kafka-ui:main` is for testing only and should be removed from deployment.

## Kafka Topics

| Topic | PII | Purpose |
| --- | --- | --- |
| `scan.requests` | No | Backend announces the active station request to reader-agent |
| `station.status.{stationId}` | No | Safe station code/status/queue/cooldown updates |
| `reader.status.{stationId}` | No | Safe reader lifecycle and error state |
| `reader.card-read` | Yes | Reader-to-backend card payload for active request only |
| `scan-result.{deviceSessionId}` | Yes | Private scan result for one iPad session |
| `scan.rejections` | No card payload | Cancel and wrong-patient events |
| `audit.scan-events` | No raw card/photo | Audit event stream |

Never put full card data, address, photo, citizen ID, or raw SmartCard output on station-wide topics.

## Environment

Copy `.env.example` to `.env` and adjust values.

```env
KAFKA_BROKERS=localhost:9092
BACKEND_PORT=3001
SCAN_REQUEST_TTL_SECONDS=90
STATION_COOLDOWN_MS=3000
STATION_ID=A01
READER_ID=A01-PC-01
INSERT_CARD_DELAY_MS=500
READ_TIMEOUT_MS=5000
VITE_BACKEND_URL=http://localhost:3001
```

## Development

Install dependencies:

```powershell
npm install
```

Run services:

```powershell
npm run dev:backend
npm run dev:reader
npm run dev:nurse
npm run dev:station
```

Default local URLs:

```text
Backend:         http://localhost:3001
Nurse webapp:   Vite-assigned port, commonly http://localhost:5173
Station display: http://localhost:3002
Kafka UI:       http://localhost:8080
```

Do not run `npm run build` without project-owner approval.

## App Responsibilities

### Backend

- Creates scan requests and 5-character turn codes.
- Maintains one active request per station plus queued requests.
- Starts the scan expiry timer only when a request becomes active on the station.
- Publishes safe station status with expiry, queue depth, and cooldown.
- Routes full card results by `requestId + deviceSessionId`.
- Handles cancel, wrong-patient/misroute, expiry, delivery, and audit events.

### Reader Agent

- Runs on the Windows station PC.
- Uses `goomgumx/thai-id-card-reader` through PC/SC and `pcsclite`.
- Consumes active `scan.requests`.
- Publishes safe reader status and full card reads to backend-consumed Kafka topics.
- Clears active request on station lifecycle updates such as canceled, expired, delivered, cooldown, or neutral.

### Nurse Webapp

- Creates scan requests from the iPad.
- Shows the human turn code and queued/waiting/expired/result states.
- Receives private card results through backend SSE backed by Kafka.
- Displays patient fields and `photoAsBase64Uri` only in the private result view.
- Provides `Cancel` before result and `Wrong Patient / Not Mine` after result.

### Station Display

- Shows only safe station information: code, status, queue depth, expiry/cooldown countdown, and reader status.
- Receives status through backend SSE backed by Kafka.
- Never displays citizen ID, patient name, address, photo, or raw card data.

## SmartCard Reader Notes

The reader dependency is installed from:

```text
github:goomgumx/thai-id-card-reader
```

The app imports the package library entry directly because the package's declared `main` currently points at an older/demo path that expects `config.json`.

If `pcsclite` cannot load, verify runtime:

```powershell
node -p "process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules"
node -e "require('pcsclite'); console.log('pcsclite loaded')"
```

Rebuild `pcsclite` with the Visual Studio x64 environment:

```powershell
npm install --save-dev node-gyp@latest
```

`.npmrc` should contain:

```ini
node_gyp=./node_modules/node-gyp/bin/node-gyp.js
```

Then run:

```powershell
cmd.exe /d /s /c "call ""C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"" && set npm_config_node_gyp=%CD%\node_modules\node-gyp\bin\node-gyp.js&& npm rebuild pcsclite"
```

Check the Windows Smart Card service:

```powershell
Get-Service SCardSvr
Start-Service SCardSvr
```

## Security Rules

- The 5-character code is not a routing secret; it is only for human visual confirmation.
- Backend routes private results by `requestId + deviceSessionId`.
- Station display and station-wide Kafka topics must remain PII-free.
- Full card payload and photo go only to `scan-result.{deviceSessionId}` and the private nurse iPad result bridge.
- Do not log citizen ID, full address, photo base64, laser/back number, or raw SmartCard output.
- OCR remains a future fallback path and must follow the same private delivery rule.
