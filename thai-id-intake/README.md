# Thai ID Intake

Secure Thai ID SmartCard intake workflow for a station PC, backend coordinator, nurse iPad webapp, and Kafka event backbone.

Kafka is the core of this project. The backend owns scan authorization and private routing, while Kafka carries scan requests, station status, reader events, private scan results, rejections, and audit events.

## Structure

```text
thai-id-intake/
  apps/
    reader-agent/   # Windows station PC service for goomgumx Thai ID SmartCard reads
    backend/        # Scan transaction authority and Kafka coordinator
    nurse-webapp/   # iPad webapp for one-tap nurse scan requests
  packages/
    shared-types/   # Shared TypeScript contracts and Kafka topic names
```

## Secure Scan Flow

1. Nurse taps `Scan ID Card` on the iPad.
2. Backend creates a scan request with `requestId`, `deviceSessionId`, station ID, short turn code, and expiry.
3. Kafka publishes safe station status so the station PC shows only code/status.
4. Nurse compares the iPad code with the station PC code.
5. Reader agent reads the inserted card and publishes a card-read event to Kafka.
6. Backend validates the active request and publishes the full card result only to `scan-result.{deviceSessionId}`.
7. Nurse webapp autofills the patient record for that private iPad session.

## Kafka Docker

Start local Kafka and the local testing UI:

```powershell
docker compose up -d kafka kafka-ui
```

Default broker:

```env
KAFKA_BROKERS=localhost:9092
```

Kafbat Kafka UI is available for local testing at:

```text
http://localhost:8080
```

The UI service uses `kafbat/kafka-ui:main` and is for development/testing only. Remove it from deployment environments.

Stop Kafka:

```powershell
docker compose down
```

## Kafka Topics

| Topic | Producer | Consumer | PII allowed |
| --- | --- | --- | --- |
| `scan.requests` | backend | reader-agent | No |
| `station.status.{stationId}` | backend | station display/reader-agent | No |
| `reader.status.{stationId}` | reader-agent | backend/station monitor | No |
| `reader.card-read` | reader-agent | backend | Yes, backend-consumed only |
| `scan-result.{deviceSessionId}` | backend | private iPad session bridge | Yes, private only |
| `scan.rejections` | nurse webapp/backend | backend | No full card payload |
| `audit.scan-events` | backend | audit storage | No raw SmartCard/photo data |

Station-wide topics must never contain citizen ID, full names, address, photo, laser number, or raw SmartCard output.

## Environment

Copy `.env.example` to `.env` in local development and adjust as needed.

```env
KAFKA_BROKERS=localhost:9092
BACKEND_PORT=3001
SCAN_REQUEST_TTL_SECONDS=90
STATION_ID=A01
READER_ID=A01-PC-01
INSERT_CARD_DELAY_MS=500
READ_TIMEOUT_MS=5000
VITE_BACKEND_URL=http://localhost:3001
```

## Development Commands

Install dependencies:

```powershell
npm install
```

Run backend:

```powershell
npm run dev:backend
```

Run reader agent:

```powershell
npm run dev:reader
```

Run nurse webapp:

```powershell
npm run dev:nurse
```

Do not run `npm run build` unless the project owner approves it.

## App Responsibilities

### Backend

- Creates scan requests and short turn codes.
- Maintains active request state per station.
- Publishes safe station status to Kafka.
- Consumes `reader.card-read`.
- Validates request expiry and station binding.
- Publishes full scan result only to `scan-result.{deviceSessionId}`.
- Records audit events for request, scan, delivery, rejection, expiry, and errors.

### Reader Agent

- Runs on the Windows station PC.
- Uses `goomgumx/thai-id-card-reader` / PCSC integration points.
- Consumes active scan request events.
- Shows only station code/status.
- Publishes normalized card reads to Kafka.
- Debounces duplicate card reads.
- Logs only non-sensitive status.

### Nurse Webapp

- Provides one primary `Scan ID Card` action.
- Shows the short turn code for visual comparison.
- Receives private result delivery through a backend Kafka-backed bridge.
- Autofills patient fields without an extra Submit tap.
- Supports `Wrong Patient / Not Mine` rejection.

## Windows SmartCard Reader Troubleshooting

Use Node.js 20.x on Windows x64. If `pcsclite` fails with `ERR_DLOPEN_FAILED` or `not a valid Win32 application`, verify the runtime:

```powershell
node -p "process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules"
```

Install a project-local `node-gyp` and point npm to it:

```powershell
npm install --save-dev node-gyp@latest
```

Create `.npmrc`:

```ini
node_gyp=./node_modules/node-gyp/bin/node-gyp.js
```

Rebuild from a Visual Studio x64 build environment:

```powershell
cmd.exe /d /s /c "call ""C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"" && set npm_config_node_gyp=%CD%\node_modules\node-gyp\bin\node-gyp.js&& npm rebuild pcsclite"
```

Check the Windows Smart Card service:

```powershell
Get-Service SCardSvr
Start-Service SCardSvr
```

## Security Rules

- No full card data on station-wide Kafka topics.
- No full card data on station PC display.
- Full scan payload goes only to the requesting nurse/device session.
- Avoid logging citizen ID, full address, photo base64, laser/back number, or raw SmartCard output.
- Expire scan requests quickly, defaulting to 90 seconds.
- Wrong-patient handling marks the scan rejected or misrouted and requires rescan under the correct code.
- OCR remains a manual fallback path and must follow the same private delivery rule.
