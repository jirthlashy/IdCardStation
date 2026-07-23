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
- Demo stdin commands are disabled by default. For local testing only, set `ENABLE_DEMO_COMMANDS=true` to enable:
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

Run these commands from the npm workspace:

```powershell
cd thai-id-intake
docker compose up -d kafka kafka-ui
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

## Current Deployment Packaging

`deploy-transfer/` is the current manual transfer bundle. It is ignored by git, so it must be copied/transferred separately or intentionally force-added if the team wants to version it.

```text
deploy-transfer/
  server/
    backend/
    kafka_2.13-4.3.1/
    nurse-webapp/
    station-display/
    server.env
    START_SERVER_JAVA.sh
    STOP_SERVER_JAVA.sh
    START_SERVER_PM2.sh
    STOP_SERVER_PM2.sh
    README.md
  reader-agent/
    app/
    node_modules/
    .reader-support/
      reader.env
      THAI_ID_READER_LAUNCHER.ps1
      RUN_READER_AGENT_BACKGROUND.ps1
      STOP_READER_AGENT.ps1
    Thai ID Reader.bat
    README.md
```

Server side runs on Ubuntu/Linux. Reader side runs on the Windows PC connected to the smart card reader.

The split is intentional.

- `server/` contains Kafka, backend, and prebuilt static web apps.
- `reader-agent/` contains the Windows reader runtime, `app/index.js`, and its `node_modules`.
- `deploy-transfer/server/backend/apps/backend/dist/index.js` is the backend entrypoint.
- The reader runtime has been flattened for deployment: `reader-agent/app/index.js` is the entrypoint instead of the old nested `apps/reader-agent/dist/apps/reader-agent/src/index.js` path.
- Normal reader startup and stop are both handled through the single visible `Thai ID Reader.bat` launcher.
- The GUI writes `.reader-support/reader.env`, checks Kafka/Node/pcsclite, then exits. The CMD window starts the reader, shows live output, and owns reader-agent lifetime.
- Reader-agent lifetime is intentionally tied to the CMD window: closing CMD stops reader-agent.
- The hidden support scripts prefer a bundled Node runtime at `reader-agent/runtime/node/node.exe` when present, then fall back to `reader-agent/node.exe`, then system `node`.
- The tracked source for the Windows reader launcher lives in `thai-id-intake/apps/reader-agent/deploy/windows/`, including its app-owned sync script. Run `npm run sync:reader-launcher` from `thai-id-intake/` to refresh the deploy-transfer launcher files from that source.
- `pcsclite` is a native addon. Its compiled `pcsclite.node` must match the Node ABI used to run the reader-agent. The current dev workspace uses Node `v26.4.0`, ABI `147`, win32 x64.
- The current `deploy-transfer/reader-agent` folder does not include `runtime/node/node.exe`; if the reader PC uses system Node, verify the system Node ABI matches the packaged `pcsclite` build.
- Kafka UI is not included in the transfer bundle.

The current real-server path is PM2:

```bash
cd deploy-transfer/server
nano server.env
bash START_SERVER_PM2.sh
pm2 list
pm2 logs
```

Stop PM2 deployment with:

```bash
bash STOP_SERVER_PM2.sh
```

Important `server.env` points:

```env
SERVER_IP=192.168.x.x
KAFKA_PORT=9092
BACKEND_PORT=3001
NURSE_WEB_PORT=3000
STATION_DISPLAY_PORT=3002
MANAGE_UFW_RULES=true
```

Use a fixed `SERVER_IP` for real deployment. `SERVER_IP=auto` is only safe for quick VM testing because it may pick the wrong NIC/VPN/Docker address.

The PM2 start script opens UFW ports for the configured nurse/backend/station/Kafka ports when UFW is active and `MANAGE_UFW_RULES=true`. It records only newly added ports in `.ufw-opened-ports`.

The PM2 stop script removes only those recorded UFW rules. Existing UFW rules from other projects are left alone.

If the browser from another PC cannot open `http://SERVER_IP:3000` but ping works, check:

```bash
pm2 list
sudo ss -ltnp | grep -E ':3000|:3001|:3002|:9092'
curl -I http://127.0.0.1:3000
sudo ufw status
```

Ping only proves ICMP reachability. It does not prove TCP ports are open.

### GitLab / Transfer Gotcha

Current `.gitignore` ignores the deployment bundle:

```text
deploy-transfer/
```

So a normal `git add .` will not publish the ready-to-run deployment bundle. If a new session says "clone from GitLab and deploy", first verify whether the deployment bundle actually exists in the clone:

```bash
ls deploy-transfer/server/START_SERVER_PM2.sh
```

If it is missing, either transfer the bundle separately, force-add intended deployment files, or build/package again on a machine that has dependencies.

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
INSERT_CARD_DELAY_MS=2000
READ_TIMEOUT_MS=5000
ENABLE_DEMO_COMMANDS=false
VITE_BACKEND_URL=http://localhost:3001
VITE_STATION_ID=A01
VITE_NURSE_ID=unassigned-nurse
VITE_RESULT_AUTO_CLEAR_SECONDS=120
```

## Recent Changes To Remember

- Current docs were moved to the repo root: `README.md`, `DEVELOPER_CONTEXT.md`, `handoff.md`, and `PCSC_NATIVE_ADDON_TROUBLESHOOTING.md`.
- Removed the old `thai-id-intake/md/` folder and Mermaid `.mmd` notes.
- Current manual transfer bundle is `deploy-transfer/server` and `deploy-transfer/reader-agent`.
- Added reader GUI launcher and stop script for non-coder reader PC operators.
- Consolidated reader startup/stop through one visible launcher: `deploy-transfer/reader-agent/Thai ID Reader.bat`. Internal PowerShell scripts and generated config live under hidden `.reader-support/`.
- Added tracked reader launcher source under `thai-id-intake/apps/reader-agent/deploy/windows/` and an app-owned `sync:launcher` script, exposed as root `sync:reader-launcher`, to copy it into the ignored transfer bundle.
- Flattened reader-agent deployment runtime to `reader-agent/app/` and removed the old nested TypeScript workspace `dist/apps/reader-agent/src` deployment path.
- Flattened backend build/deploy output to `apps/backend/dist/index.js`.
- Dev workspace currently runs on Node `v26.4.0` / ABI `147`.
- Added server startup scripts for both Java/no-PM2 and PM2 modes.
- Added PM2 UFW port management controlled by `MANAGE_UFW_RULES=true`.
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

Native reader checks passed after the Node update:

```powershell
node -e "require('pcsclite'); console.log('pcsclite loaded for ' + process.version + ' abi ' + process.versions.modules)"
node -e "require('pcsclite'); console.log('dev pcsclite loaded for ' + process.version + ' abi ' + process.versions.modules)"
```

Both were verified on Node `v26.4.0` / ABI `147`; one check was in the transfer reader bundle and one was in `thai-id-intake`.

## Known Caveats

- State is currently in memory. Restarting backend clears active queues/results.
- Hospital SSO/device management remains future work; v1 production hardening uses backend-issued request access tokens.
- `dev:all` is local-only and not part of production.
- `kafbat/kafka-ui:main` is local testing only and should be removed from deployment.
- Production Kafka should use broker/network ACLs, bounded retention for PII topics, and disabled topic auto-creation where possible.
- Built frontend assets have `VITE_BACKEND_URL` baked in. If the backend IP/port changes, rebuild the frontend before packaging or the pages may load but call the wrong backend.
- On real servers with many projects, check port ownership before starting: `sudo ss -ltnp | grep -E ':3000|:3001|:3002|:9092'`.
- PM2/UFW deployment may need sudo. If infra owns firewall policy, confirm before allowing/removing ports.
- `node-gyp`/`pcsclite` Windows setup can be fragile. See `PCSC_NATIVE_ADDON_TROUBLESHOOTING.md`. If Node changes, rebuild `pcsclite` for the new ABI before running dev reader-agent or packaging the transfer bundle.
- Node 26 generated MSVC project flags for `pcsclite` that did not link cleanly with the local VS toolchain. The successful rebuild path was: configure with `node-gyp`, remove generated `-flto=thin` and `/opt:lldltojobs=2` from `pcsclite.vcxproj`, then run `node-gyp build`.
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
3. Retry test, with `ENABLE_DEMO_COMMANDS=true` in local reader-agent env:
   - Use `demo-read-error`.
   - Confirm station and nurse show reinsert-card message with same code.
4. Private result test, with `ENABLE_DEMO_COMMANDS=true` in local reader-agent env:
   - Use `demo-read`.
   - Confirm result appears only on matching iPad session.
   - Confirm photo auto-clears.
5. Security audit:
   - Confirm `station.status.*` and `reader.status.*` remain PII-free.
   - Confirm full data only appears on `reader.card-read` and private result delivery.
