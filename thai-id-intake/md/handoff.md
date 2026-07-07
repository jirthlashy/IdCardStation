# Thai ID Intake Handoff

Use this file to continue in a new chat session.

## Current Project

`thai-id-intake` is a Node/TypeScript monorepo for a secure Thai ID SmartCard intake flow.

Kafka is the core event backbone. The backend is the routing authority. Nurse iPads and the station display do not connect directly to Kafka; they use backend HTTP/SSE.

```text
thai-id-intake/
  apps/
    backend/
    reader-agent/
    nurse-webapp/
    station-display/
  packages/
    shared-types/
  md/
```

## Main Workflow

1. Nurse taps `Scan ID Card` on iPad.
2. Backend creates a request with `requestId`, backend-owned `deviceSessionId`, request access token, `stationId`, and a 5-character `turnCode`.
3. If reader/station is ready, backend activates the request; otherwise the request queues.
4. Queued requests do not burn active scan TTL. They can expire from queue after `QUEUED_REQUEST_MAX_AGE_SECONDS`.
5. Station display shows only safe data: active code, timing, queue depth, reader state.
6. Nurse visually confirms iPad code matches station display code.
7. Reader-agent reads the SmartCard for the active request.
8. Backend validates active `requestId`, looks up `deviceSessionId`, and sends full data only to the request-token-protected private iPad stream.
9. Nurse UI displays patient fields and `photoAsBase64Uri`, then auto-clears after `RESULT_AUTO_CLEAR_SECONDS`.
10. Station goes delivered -> cooldown -> next queued request or neutral.

The 5-character code is only for humans. Browser-private routing uses `requestId + requestAccessToken`; Kafka-internal result topics still use backend-owned `deviceSessionId`.

## Apps

### `apps/backend`

- Express API and SSE bridge.
- Kafka coordinator and scan transaction authority.
- Maintains in-memory station queue/state.
- On restart, publishes neutral safe station state; active scans are invalid and nurses must rescan.
- Handles station lifecycle: `neutral`, `queued`, `active`, `reading`, `delivered`, `cooldown`, `canceled`, `expired`, `failed`, `misrouted`.
- Aggregates reader heartbeat into safe station readiness.
- Exposes:
  - `GET /health`
  - `GET /api/stations/:stationId/readiness`
  - `GET /api/stations/:stationId/status/events`
  - `POST /api/scan-requests`
  - `GET /api/scan-requests/:requestId/events`
  - `GET /api/scan-requests/:requestId/result-events?accessToken=...`
  - `POST /api/scan-requests/:requestId/rejections`

### `apps/reader-agent`

- Windows station PC service.
- Uses `goomgumx/thai-id-card-reader` through `thai-id-card-reader/build/index.js`.
- Uses PC/SC and `pcsclite`.
- Consumes active `scan.requests` and station lifecycle updates.
- Produces:
  - reader heartbeat every `READER_HEARTBEAT_MS` milliseconds, currently default `10000`.
  - safe reader states.
  - full card-read payload only to `reader.card-read`.
- Demo stdin commands:
  - `demo-read`
  - `demo-card-in`
  - `demo-card-out`
  - `demo-read-error`

### `apps/nurse-webapp`

- iPad-facing UI.
- Shows system connection and station readiness before scan.
- Disables `Scan ID Card` when reader is offline/not ready.
- Shows queued/waiting/reading/retryable/expired/result states.
- Shows `Your turn now` when a queued request becomes active.
- Displays `photoAsBase64Uri` in private result view.
- Has `Cancel` before result and `Wrong Patient / Not Mine` after result.
- Auto-clears patient data/photo after configured result clear time.

### `apps/station-display`

- Station PC display app.
- Shows safe station info only.
- Shows reader ready/offline and heartbeat freshness.
- Shows active expiry, cooldown countdown, queue depth.
- Operational prompts include reader offline, scan this code, reading, read failed/reinsert card, remove card, preparing next code.

### `packages/shared-types`

- Shared contracts and Kafka topic helpers.
- Includes normalized Thai ID card payload, Kafka envelope, request/status/result/rejection/audit types.
- Important rule: station/readiness/reader status types must remain PII-free.

## Kafka Topics

| Topic | Sensitive? | Purpose |
| --- | --- | --- |
| `scan.requests` | No | Backend announces active station request to reader-agent. |
| `station.status.{stationId}` | No | Backend publishes safe station state: code, queue, expiry, cooldown, canceled/expired/retry prompts. |
| `reader.status.{stationId}` | No | Reader-agent publishes heartbeat and safe reader lifecycle. |
| `reader.card-read` | Yes | Reader-agent publishes full SmartCard payload for backend validation. |
| `scan-result.{deviceSessionId}` | Yes | Backend publishes internal private result for one backend-owned device session. |
| `scan.rejections` | No card payload | Cancel and wrong-patient/misroute events. |
| `audit.scan-events` | No raw card/photo | Operational audit trail without raw card payload/photo. |

Station-wide topics must never contain citizen ID, full name, address, photo, or raw SmartCard output.

## Local Run

Start Kafka and Kafka UI:

```powershell
docker compose up -d kafka kafka-ui
```

Run all four apps for local testing:

```powershell
npm run dev:all
```

`dev:all` is a local testing helper only. It uses `concurrently` from dev dependencies and can be removed before production.

Run apps separately:

```powershell
npm run dev:backend
npm run dev:reader
npm run dev:nurse
npm run dev:station
```

Do not run `npm run build` unless the project owner explicitly approves.

## Key Env Defaults

```env
KAFKA_BROKERS=localhost:9092
BACKEND_PORT=3001
ALLOWED_STATION_IDS=A01
CORS_ALLOWED_ORIGINS=
SCAN_REQUEST_TTL_SECONDS=90
STATION_COOLDOWN_MS=3000
QUEUED_REQUEST_MAX_AGE_SECONDS=300
RESULT_AUTO_CLEAR_SECONDS=120
MAX_QUEUE_DEPTH_PER_STATION=10
SCAN_REQUEST_RATE_LIMIT_WINDOW_MS=60000
SCAN_REQUEST_RATE_LIMIT_MAX=20
STATION_ID=A01
READER_ID=A01-PC-01
READER_HEARTBEAT_MS=10000
INSERT_CARD_DELAY_MS=500
READ_TIMEOUT_MS=5000
VITE_BACKEND_URL=http://localhost:3001
VITE_STATION_ID=A01
VITE_NURSE_ID=unassigned-nurse
VITE_RESULT_AUTO_CLEAR_SECONDS=120
```

## Recent Changes To Remember

- Heartbeat default changed from 5 seconds to 10 seconds.
- Added `npm run dev:all`.
- Added station readiness aggregation.
- Added queued max age so queued requests do not burn active scan TTL.
- Added retryable read-failure flow: same code stays active until active TTL expires.
- Added reader heartbeat/card lifecycle states.
- Added nurse readiness panel and station offline warning.
- Added station display reader heartbeat freshness.
- Added private result auto-clear.
- Expanded README Kafka topic explanation.
- Updated Mermaid docs:
  - `md/full_scan_sequence.mmd`
  - `md/kafka_dataflow_overview.mmd`

## Verification Already Run

Recent type checks passed:

```powershell
npm run lint -w @thai-id-intake/shared-types
npm run lint -w @thai-id-intake/backend
npm run lint -w @thai-id-intake/reader-agent
npm run lint -w @thai-id-intake/nurse-webapp
npm run lint -w @thai-id-intake/station-display
```

No `npm run build` was run.

## Known Caveats

- State is currently in memory. Restarting backend clears active queues/results.
- Hospital SSO/device management remains future work; v1 production hardening uses backend-issued request access tokens.
- `dev:all` is local-only and not part of production.
- `kafbat/kafka-ui:main` is local testing only and should be removed from deployment.
- Production Kafka should use broker/network ACLs, bounded retention for PII topics, and disabled topic auto-creation where possible.
- `node-gyp`/`pcsclite` Windows setup can be fragile. See `md/tools.md`.
- The reader library package main path has quirks, so reader-agent imports `thai-id-card-reader/build/index.js`.
- Real hardware behavior for card inserted/removed depends on what PC/SC/library events expose.

## Best Next Steps

1. Manual two-nurse queue test:
   - Nurse 1 active.
   - Nurse 2 queued with no active countdown.
   - Nurse 1 expires/cancels/completes.
   - Nurse 2 becomes active with fresh timer and `Your turn now`.
2. Reader downtime test:
   - Stop reader-agent.
   - Confirm nurse shows reader offline and scan is disabled.
   - Restart reader-agent and confirm readiness recovers after heartbeat.
3. Retry test:
   - Use `demo-read-error`.
   - Confirm station and nurse show reinsert-card message with same code.
4. Private result test:
   - Use `demo-read`.
   - Confirm result appears only on matching iPad session.
   - Confirm photo auto-clears.
5. Security audit:
   - Confirm `station.status.*` and `reader.status.*` remain PII-free.
   - Confirm full data only appears on `reader.card-read` and private result delivery.
