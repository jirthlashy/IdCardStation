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
3. Nurse app pre-subscribes to safe station readiness. If the reader is offline, the scan button is disabled until heartbeat recovers.
4. If the station is busy or cooling down, the request is queued. Queued requests do not burn scan time, but stale queued requests expire after `QUEUED_REQUEST_MAX_AGE_SECONDS`.
5. Station display shows only the active turn code, queue depth, active expiry/cooldown, status, and reader heartbeat state.
6. Nurse compares the iPad code with the station display code.
7. Reader agent reads the inserted Thai ID card for the active request.
8. If a retryable read error happens, the same request stays active until its active TTL expires. Nurse and station show `Read failed, reinsert card`.
9. Backend validates the active `requestId`, looks up `deviceSessionId`, and publishes the full card result only to that private iPad session.
10. Nurse UI auto-clears private patient fields/photo after `RESULT_AUTO_CLEAR_SECONDS`.
11. Station moves `delivered -> cooldown` for 3 seconds, then activates the next queued request with a fresh expiry timer or returns to `neutral`.

Station lifecycle:

```text
neutral -> active -> reading -> delivered -> cooldown -> neutral/next queued request
```

Exception states include `queued`, `canceled`, `expired`, `failed`, and `misrouted`.

Auth/session hardening is intentionally deferred until hospital nurseID and device-auth rules are known.

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

Kafka is the event backbone. Nurse iPads and the station display do not connect to Kafka directly; they connect to the backend through HTTP/SSE. The backend is the routing authority for private data.

| Topic | Producer | Consumer | Sensitive Data | Purpose |
| --- | --- | --- | --- | --- |
| `scan.requests` | Backend | Reader agent | No | Announces the one active request for a station. Contains `requestId`, `stationId`, `deviceSessionId`, 5-character `turnCode`, status, and timing metadata. The reader uses this to know which request is currently allowed to read. |
| `station.status.{stationId}` | Backend | Reader agent, backend SSE bridge | No | Safe station-wide state such as active code, active expiry, cooldown, queue depth, canceled/expired/delivered states, and retry prompts. Example: `station.status.A01`. This topic must stay safe for public station screens. |
| `reader.status.{stationId}` | Reader agent | Backend | No | Safe reader lifecycle events: heartbeat every `READER_HEARTBEAT_MS`, ready/offline, waiting for card, reading, card inserted/removed when available, and retryable read errors. Example: `reader.status.A01`. |
| `reader.card-read` | Reader agent | Backend | Yes | Full card-read payload from the SmartCard reader for the active `requestId`. May contain citizen ID, name, address, date of birth, and `photoAsBase64Uri`. Backend validates the request before private delivery. |
| `scan-result.{deviceSessionId}` | Backend | Backend private SSE bridge | Yes | Private result topic for exactly one iPad/device session. Contains normalized card data and photo after backend validates `requestId + deviceSessionId`. Example shape: `scan-result.{deviceSessionId}`. |
| `scan.rejections` | Backend | Backend/audit flow | No card payload | Cancel and wrong-patient/misroute events. Contains request metadata and rejection reason, not card fields or photo. |
| `audit.scan-events` | Backend | Audit tooling/Kafka UI during dev | No raw card/photo | Operational audit trail for request creation, activation, delivery, rejection, expiry, retryable read errors, duplicates, and misroutes. Keep raw PII out of this topic. |

Sensitivity rules:

- Station-wide topics are PII-free: `scan.requests`, `station.status.*`, and `reader.status.*`.
- Private/PII topics are restricted to backend-controlled routing: `reader.card-read` and `scan-result.{deviceSessionId}`.
- Never put full card data, address, photo, citizen ID, or raw SmartCard output on station-wide topics.
- `scan.rejections` and `audit.scan-events` may reference request IDs and station IDs, but must not include raw card/photo data.

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
READER_HEARTBEAT_MS=10000
QUEUED_REQUEST_MAX_AGE_SECONDS=300
RESULT_AUTO_CLEAR_SECONDS=120
VITE_BACKEND_URL=http://localhost:3001
VITE_STATION_ID=A01
VITE_RESULT_AUTO_CLEAR_SECONDS=120
```

## Development

Install dependencies:

```powershell
npm install
```

Run services:

```powershell
npm run dev:all
```

`dev:all` is only a local testing helper. It uses the dev dependency `concurrently` to run all four apps in one terminal and is not required for production. It can be removed later by uninstalling `concurrently`, deleting the `dev:all` script from `package.json`, and removing this note.

Or run each service in its own terminal:

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
- Exposes safe station readiness with reader heartbeat, queue depth, active expiry, cooldown, and `canRequestScan`.
- Starts no active scan timer while a request is queued, but removes stale queued requests after `QUEUED_REQUEST_MAX_AGE_SECONDS`.
- Publishes safe station status with expiry, queue depth, cooldown, and retryable read-failure messages.
- Routes full card results by `requestId + deviceSessionId`.
- Ignores duplicate card-read delivery for fulfilled/canceled/expired requests and audits the duplicate attempt.
- Handles cancel, wrong-patient/misroute, expiry, delivery, and audit events.
- Emits a private result-clear recommendation after `RESULT_AUTO_CLEAR_SECONDS`.

### Reader Agent

- Runs on the Windows station PC.
- Uses `goomgumx/thai-id-card-reader` through PC/SC and `pcsclite`.
- Consumes active `scan.requests`.
- Publishes safe reader status and full card reads to backend-consumed Kafka topics.
- Publishes heartbeat every `READER_HEARTBEAT_MS`.
- Publishes safe card lifecycle/retry states where available: `card_inserted`, `card_removed`, and `read_failed_retryable`.
- Keeps the same active request after retryable read failures so a nurse does not need to request a new code.
- Clears active request on station lifecycle updates such as canceled, expired, delivered, cooldown, or neutral.

### Nurse Webapp

- Creates scan requests from the iPad.
- Shows station readiness before scan: ready, busy, reader offline, queue depth, active expiry, and cooldown.
- Pre-opens only safe station readiness/status SSE. Private result SSE still starts only after this iPad creates a request.
- Shows the human turn code and queued/waiting/expired/result states.
- Shows `Your turn now` when this nurse's queued request becomes active.
- Shows retryable read failure as `Read failed, reinsert card. Same code is still active.`
- Receives private card results through backend SSE backed by Kafka.
- Displays patient fields and `photoAsBase64Uri` only in the private result view.
- Auto-clears private patient fields/photo after `RESULT_AUTO_CLEAR_SECONDS`.
- Provides `Cancel` before result and `Wrong Patient / Not Mine` after result.

### Station Display

- Shows only safe station information: code, status, queue depth, expiry/cooldown countdown, reader readiness, and heartbeat freshness.
- Emphasizes operational prompts such as `Scan this code`, `Reading`, `Read failed - reinsert card`, `Remove card`, `Preparing next code`, and `Reader offline`.
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
