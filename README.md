# Thai ID Intake

Secure Thai ID SmartCard intake for a nurse iPad, A01 station display, Windows reader agent, backend coordinator, and Kafka event backbone.

Kafka carries the event flow. The backend owns scan authorization, station queue state, cooldown, and private result routing. The 5-character code is for human confirmation only; private browser actions are bound to `requestId + requestAccessToken`.

## Project Structure

```text
.
  README.md
  DEVELOPER_CONTEXT.md
  handoff.md
  PCSC_NATIVE_ADDON_TROUBLESHOOTING.md
  thai-id-intake/
    apps/
      backend/          # Scan request API, station queue/state machine, Kafka coordinator
      reader-agent/     # Windows PC/SC SmartCard reader service and GUI launcher source
      nurse-webapp/     # iPad scan request and private result UI
      station-display/  # A01 display for safe code/status only
    packages/
      shared-types/     # Shared TypeScript contracts and Kafka topic helpers
```

The npm workspace starts at `thai-id-intake/`.

```text
thai-id-intake/
  apps/
  packages/
```

## Docs Map

- `DEVELOPER_CONTEXT.md` explains architecture boundaries, security invariants, and change guidelines for the next developer.
- `handoff.md` captures current project state, deployment notes, caveats, and recommended next tests.
- `PCSC_NATIVE_ADDON_TROUBLESHOOTING.md` is the focused Windows `pcsclite` / `node-gyp` recovery guide for the reader-agent.

## Current Scan Flow

1. Nurse taps `Scan ID Card` on the iPad.
2. Backend creates a request with `requestId`, backend-owned `deviceSessionId`, request access token, `stationId`, 5-character `turnCode`, and expiry.
3. Nurse app pre-subscribes to safe station readiness. If the reader is offline, the scan button is disabled until heartbeat recovers.
4. If the station is busy or cooling down, the request is queued. Queued requests do not burn scan time, but stale queued requests expire after `QUEUED_REQUEST_MAX_AGE_SECONDS`.
5. Station display shows only the active turn code, queue depth, active expiry/cooldown, status, and reader heartbeat state.
6. Nurse compares the iPad code with the station display code.
7. Reader agent reads the inserted Thai ID card for the active request.
8. If a retryable read error happens, the same request stays active until its active TTL expires. Nurse and station show `Read failed, reinsert card`.
9. Backend validates the active `requestId`, looks up `deviceSessionId`, and publishes the full card result only to the request-owned private iPad stream.
10. Nurse UI auto-clears private patient fields/photo after `RESULT_AUTO_CLEAR_SECONDS`.
11. Station moves `delivered -> cooldown` for 3 seconds, then activates the next queued request with a fresh expiry timer or returns to `neutral`.

Station lifecycle:

```text
neutral -> active -> reading -> delivered -> cooldown -> neutral/next queued request
```

Exception states include `queued`, `canceled`, `expired`, `failed`, and `misrouted`.

Hospital SSO/device management is still future work. The current production hardening uses a backend-issued request access token for request-status, private-result, cancel, and wrong-patient actions.

## Local Kafka

Start Kafka and local Kafka UI:

```powershell
cd thai-id-intake
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

For production, use broker/network ACLs so only backend and reader-agent can access sensitive topics, disable topic auto-creation where possible, and configure bounded retention for PII-bearing topics such as `reader.card-read` and `scan-result.*`.

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
ALLOWED_STATION_IDS=A01
CORS_ALLOWED_ORIGINS=
SCAN_REQUEST_TTL_SECONDS=90
STATION_COOLDOWN_MS=3000
STATION_ID=A01
READER_ID=A01-PC-01
INSERT_CARD_DELAY_MS=2000
READ_TIMEOUT_MS=5000
READER_HEARTBEAT_MS=10000
ENABLE_DEMO_COMMANDS=false
QUEUED_REQUEST_MAX_AGE_SECONDS=300
RESULT_AUTO_CLEAR_SECONDS=120
MAX_QUEUE_DEPTH_PER_STATION=10
SCAN_REQUEST_RATE_LIMIT_WINDOW_MS=60000
SCAN_REQUEST_RATE_LIMIT_MAX=20
VITE_BACKEND_URL=http://localhost:3001
VITE_STATION_ID=A01
VITE_NURSE_ID=unassigned-nurse
VITE_RESULT_AUTO_CLEAR_SECONDS=120
```

## Development

Install dependencies:

```powershell
cd thai-id-intake
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

`npm run build` is allowed as a normal verification step.

## Deployment Bundle

`deploy-transfer/` is the full offline transfer bundle. `deploy-transfer-lite/`
is the smaller online-install alternative. Both are ignored by git, so treat
them as generated/operator-facing output rather than source of truth.

- `deploy-transfer/server/` goes to the Ubuntu/server PC.
- `deploy-transfer/reader-agent/` goes to the Windows PC connected to the smart card reader.
- The reader PC operator should only need to double-click `Thai ID Reader.bat`.

`deploy-transfer/` is the complete offline transfer: its Windows reader carries
Node `v26.4.0` and the matching prebuilt `pcsclite` addon, so it works after
extraction without internet, npm, or build tools.

`deploy-transfer-lite/` is the smaller online-install alternative. Its server
folder carries workspace source and builds on the Ubuntu target using
`INSTALL_SERVER_DEPS.sh`. Its Windows reader downloads Node and npm packages,
installs native build prerequisites with one UAC approval, then compiles
`pcsclite` during the first double-click of `Thai ID Reader.bat`. The lite
server needs Java, Node/npm, Python 3, Bash, PM2, `tar`, and `curl` or `wget`;
the lite reader needs internet access to Node, npm, and Microsoft download
sources. Both reader bundles still require the physical reader's vendor driver.

### Release Creator

The tracked release creator lives under:

```text
thai-id-intake/dev-deploy-script/package/
```

It stages a bundle, verifies it, writes `BUNDLE_MANIFEST.json`, then emits
exactly one artifact: either a folder or a ZIP. Test the generated bundle, not
the tracked script source directory, on the target OS.

```powershell
cd thai-id-intake
npm run package:full:folder
npm run package:full:zip
npm run package:lite:folder
npm run package:lite:zip
npm run release-input:full
npm run release-input:lite
npm run release-input:all
npm run verify:deploy
```

Folder commands create `deploy-transfer/` or `deploy-transfer-lite/` and refuse
to overwrite an existing folder by default. ZIP commands write only to the
root-level ignored `release/` folder and do not replace `deploy-transfer*`.

Packaging does not run an application build, install dependencies, or download
runtime files. It consumes existing app build output and fails clearly when a
required input is missing.

Fresh clones can prepare the ignored release inputs through the same release
creator:

```powershell
cd thai-id-intake
npm install
npm run build
npm run release-input:all
```

`release-input:*` is the expensive step. It may download Kafka and pinned Node,
install npm dependencies, and build the Windows `pcsclite` native addon. Run it
on a machine with the required network access and native build prerequisites.
It refuses to replace existing `release-input/full/` or `release-input/lite/`
unless `PACKAGE_DEPLOY.ps1` is run manually with `-ForceReplaceInput`.

Full offline packaging also requires the ignored root-level artifact input:

```text
release-input/full/
```

Seed it from a known-good full bundle with Kafka, production `node_modules`,
bundled Node `v26.4.0`, and the matching prebuilt `pcsclite` addon.

Lite reader packaging requires:

```text
release-input/lite/
```

That input carries the reader bootstrap lockfile and vendored
`thai-id-card-reader` package. Shared-types vendor output is copied from the
workspace build output.

### Manual Full Bundle Fallback

Prefer `npm run package:full:folder` or `npm run package:full:zip`. Use this
manual path only when Windows file locking, antivirus, or a restricted transfer
machine prevents the package creator from moving/zipping the staged full bundle.

Prerequisites:

```text
thai-id-intake/apps/backend/dist/
thai-id-intake/apps/nurse-webapp/dist/
thai-id-intake/apps/station-display/dist/
thai-id-intake/apps/reader-agent/dist/
release-input/full/
```

From the repo root, create the full folder bundle:

```powershell
New-Item -ItemType Directory -Force -Path deploy-transfer\server, deploy-transfer\reader-agent | Out-Null

Copy-Item release-input\full\server\kafka_2.13-4.3.1 deploy-transfer\server\kafka_2.13-4.3.1 -Recurse -Force
Copy-Item release-input\full\server\backend\node_modules deploy-transfer\server\backend\node_modules -Recurse -Force
New-Item -ItemType Directory -Force -Path deploy-transfer\server\backend\apps\backend | Out-Null
Copy-Item thai-id-intake\apps\backend\dist deploy-transfer\server\backend\apps\backend\dist -Recurse -Force
Copy-Item thai-id-intake\apps\backend\package.json deploy-transfer\server\backend\apps\backend\package.json -Force

Remove-Item -Recurse -Force deploy-transfer\server\nurse-webapp, deploy-transfer\server\station-display -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path deploy-transfer\server\nurse-webapp\assets, deploy-transfer\server\station-display\assets | Out-Null
Copy-Item thai-id-intake\apps\nurse-webapp\dist\index.html deploy-transfer\server\nurse-webapp\index.html -Force
Copy-Item thai-id-intake\apps\nurse-webapp\dist\assets\* deploy-transfer\server\nurse-webapp\assets -Recurse -Force
Copy-Item thai-id-intake\apps\station-display\dist\index.html deploy-transfer\server\station-display\index.html -Force
Copy-Item thai-id-intake\apps\station-display\dist\assets\* deploy-transfer\server\station-display\assets -Recurse -Force

foreach ($requiredWebPath in @(
  "deploy-transfer\server\nurse-webapp\index.html",
  "deploy-transfer\server\nurse-webapp\assets",
  "deploy-transfer\server\station-display\index.html",
  "deploy-transfer\server\station-display\assets"
)) {
  if (-not (Test-Path -LiteralPath $requiredWebPath)) {
    throw "Manual full bundle is missing required web output: $requiredWebPath"
  }
}

Copy-Item thai-id-intake\dev-deploy-script\server\full\* deploy-transfer\server -Recurse -Force
Copy-Item thai-id-intake\stations.example.json deploy-transfer\server\stations.example.json -Force
```

The nurse and station folders must contain `index.html` and `assets/` side by
side. If `assets/` is missing, browsers will load the page shell but fail with
404s for `/assets/index-*.js` or `/assets/index-*.css`.

Create `deploy-transfer\server\server.env` with at least:

```env
SERVER_IP=auto
KAFKA_PORT=9092
BACKEND_PORT=3001
NURSE_WEB_PORT=3000
STATION_DISPLAY_PORT=3002
STATION_ID=A01
ALLOWED_STATION_IDS=A01
MANAGE_UFW_RULES=true
SCAN_REQUEST_TTL_SECONDS=90
STATION_COOLDOWN_MS=3000
QUEUED_REQUEST_MAX_AGE_SECONDS=300
RESULT_AUTO_CLEAR_SECONDS=120
MAX_QUEUE_DEPTH_PER_STATION=10
SCAN_REQUEST_RATE_LIMIT_WINDOW_MS=60000
SCAN_REQUEST_RATE_LIMIT_MAX=20
READER_HEARTBEAT_MS=10000
```

Then copy the reader side:

```powershell
Copy-Item thai-id-intake\apps\reader-agent\dist deploy-transfer\reader-agent\app -Recurse -Force
Set-Content deploy-transfer\reader-agent\app\package.json '{ "type": "module" }'
Copy-Item release-input\full\reader-agent\node_modules deploy-transfer\reader-agent\node_modules -Recurse -Force
Copy-Item release-input\full\reader-agent\runtime deploy-transfer\reader-agent\runtime -Recurse -Force

Copy-Item "thai-id-intake\dev-deploy-script\reader-agent\windows\Thai ID Reader.bat" "deploy-transfer\reader-agent\Thai ID Reader.bat" -Force
New-Item -ItemType Directory -Force -Path deploy-transfer\reader-agent\.reader-support | Out-Null
Copy-Item thai-id-intake\dev-deploy-script\reader-agent\windows\support\THAI_ID_READER_LAUNCHER.ps1 deploy-transfer\reader-agent\.reader-support\ -Force
Copy-Item thai-id-intake\dev-deploy-script\reader-agent\windows\support\RUN_READER_AGENT_BACKGROUND.ps1 deploy-transfer\reader-agent\.reader-support\ -Force
Copy-Item thai-id-intake\dev-deploy-script\reader-agent\windows\support\STOP_READER_AGENT.ps1 deploy-transfer\reader-agent\.reader-support\ -Force
```

The full reader bundle must not include
`deploy-transfer\reader-agent\.reader-support\INSTALL_READER.ps1`; that
installer is lite-only. Manual bundling also skips `BUNDLE_MANIFEST.json` and
automated verification, so test the resulting `deploy-transfer/server` and
`deploy-transfer/reader-agent` folders before handing them to operators.

The Windows reader GUI launcher source is tracked under:

```text
thai-id-intake/dev-deploy-script/reader-agent/windows/
```

The tracked source for the server deployment scripts is:

```text
thai-id-intake/dev-deploy-script/server/
```

`thai-id-intake/dev-deploy-script/` is the tracked development source for
deployment scripts. It is not sent to a target machine directly; its contents
are copied into the ignored `deploy-transfer/` and `deploy-transfer-lite/`
operator bundles when preparing a release.

Deployment script ownership:

- `reader-agent/windows/` contains shared Windows reader launcher scripts and
  the lite-only first-run installer.
- `server/full/` contains PM2 lifecycle scripts for the full Ubuntu server
  bundle.
- `server/lite/` contains the server dependency installer and PM2 lifecycle
  scripts for the lite Ubuntu server bundle.
- Keep Kafka, built app output, `node_modules`, portable Node runtime files,
  logs, PID files, `reader.env`, and card data out of `dev-deploy-script/`.

It packages into this operator-facing shape:

```text
deploy-transfer/reader-agent/
  Thai ID Reader.bat
  .reader-support/
```

Refresh both reader deploy copies from the tracked source with:

```powershell
cd thai-id-intake
npm run sync:reader-launcher
```

The GUI writes generated reader config to `.reader-support/reader.env`, checks Kafka reachability, checks Node/`pcsclite`, then closes. The CMD window starts the reader-agent, shows live terminal output, and owns the reader lifetime.
`Thai ID Reader.bat` runs the optional bundle-owned `INSTALL_READER.ps1` hook
before opening the GUI; the full offline bundle omits that hook, while the lite
bundle uses it for first-run runtime installation. Closing the CMD window stops
the reader-agent.

## App Responsibilities

### Backend

- Creates scan requests and 5-character turn codes.
- Issues a one-time request access token for private browser ownership checks.
- Maintains one active request per station plus queued requests.
- Keeps station state in memory for v1. A backend restart publishes neutral safe station status; active scans are invalid and nurses must rescan.
- Starts the scan expiry timer only when a request becomes active on the station.
- Exposes safe station readiness with reader heartbeat, queue depth, active expiry, cooldown, and `canRequestScan`.
- Starts no active scan timer while a request is queued, but removes stale queued requests after `QUEUED_REQUEST_MAX_AGE_SECONDS`.
- Publishes safe station status with expiry, queue depth, cooldown, and retryable read-failure messages.
- Routes full card results by `requestId + requestAccessToken` on the browser side and `requestId + deviceSessionId` internally.
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
- Demo stdin commands are disabled by default. Use `ENABLE_DEMO_COMMANDS=true` only for local testing.

### Nurse Webapp

- Creates scan requests from the iPad.
- Sends configured nurse identity from `VITE_NURSE_ID` until hospital SSO exists.
- Shows station readiness before scan: ready, busy, reader offline, queue depth, active expiry, and cooldown.
- Pre-opens only safe station readiness/status SSE. Private result SSE still starts only after this iPad creates a request.
- Shows the human turn code and queued/waiting/expired/result states.
- Shows `Your turn now` when this nurse's queued request becomes active.
- Shows retryable read failure as `Read failed, reinsert card. Same code is still active.`
- Receives private card results through request-token-protected backend SSE backed by Kafka.
- Displays patient fields and `photoAsBase64Uri` only in the private result view.
- Auto-clears private patient fields/photo after `RESULT_AUTO_CLEAR_SECONDS`.
- Provides `Cancel` before result and `Wrong Patient / Not Mine` after result.

### Station Display

- Shows only safe station information: code, status, queue depth, expiry/cooldown countdown, reader readiness, and heartbeat freshness.
- Emphasizes operational prompts such as `Scan this code`, `Reading`, `Read failed - reinsert card`, `Remove card`, `Preparing next code`, and `Reader offline`.
- Receives status through backend SSE backed by Kafka.
- Never displays citizen ID, patient name, address, photo, or raw card data.

## SmartCard Reader Notes

For the full native-addon rebuild guide, see `PCSC_NATIVE_ADDON_TROUBLESHOOTING.md`.

The reader dependency is installed from:

```text
github:goomgumx/thai-id-card-reader
```

The app imports the package library entry directly because the package's declared `main` currently points at an older/demo path that expects `config.json`.

If `pcsclite` cannot load, first verify that the Node runtime matches the native addon build:

```powershell
node -p "process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules"
node -e "require('pcsclite'); console.log('pcsclite loaded')"
```

Rebuild `pcsclite` with the same Windows x64 Node runtime that will run the reader-agent:

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
- Backend routes private browser access by `requestId + requestAccessToken`.
- Station display and station-wide Kafka topics must remain PII-free.
- Full card payload and photo go only to `scan-result.{deviceSessionId}` internally and the request-token-protected private nurse iPad result bridge.
- Do not log citizen ID, full address, photo base64, laser/back number, or raw SmartCard output.
- OCR remains a future fallback path and must follow the same private delivery rule.
