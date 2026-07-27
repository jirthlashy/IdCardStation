# deploy-transfer-lite Plan

Temporary planning note for the future `deploy-transfer-lite/` bundle.

## Goal

Create a lighter Ubuntu/server deployment bundle for environments where the server has relaxed outbound internet access.

The current `deploy-transfer/` bundle is built for a tightly firewalled server, so it includes preinstalled `node_modules` and bundled runtime dependencies. The lite bundle should avoid carrying `node_modules` and should install/build on the target server instead.

## Scope

`deploy-transfer-lite/` is planned for the Ubuntu/server side only.

The Windows `reader-agent` bundle should stay as-is for now because it depends on the native `pcsclite` addon. That package is sensitive to the Node ABI and Windows build/runtime environment, so prepacking it remains safer.

## Planned Folder Shape

```text
deploy-transfer-lite/
  README.md
  server/
    README.md
    server.env
    INSTALL_SERVER_DEPS.sh
    START_SERVER_PM2.sh
    STOP_SERVER_PM2.sh
    thai-id-intake/
      package.json
      package-lock.json
      .npmrc
      tsconfig.json
      vitest.config.ts
      apps/
        backend/
        nurse-webapp/
        station-display/
      packages/
        shared-types/
```

`node_modules/` should not be included in this bundle.

## Git Ignore

The root `.gitignore` should ignore the generated lite bundle:

```gitignore
deploy-transfer-lite/
```

## Installer Behavior

`server/INSTALL_SERVER_DEPS.sh` should:

1. Read `server.env`.
2. Check required commands: `bash`, `tar`, `java`, `node`, `npm`, `python3`, `pm2`, and either `curl` or `wget`.
3. Resolve `SERVER_IP`, including `SERVER_IP=auto`.
4. Export frontend build variables before building:
   - `VITE_BACKEND_URL=http://SERVER_IP:BACKEND_PORT`
   - `VITE_STATION_ID=STATION_ID`
   - `VITE_RESULT_AUTO_CLEAR_SECONDS=RESULT_AUTO_CLEAR_SECONDS`
5. Install Kafka only when it is missing.
6. Run `npm ci` inside `server/thai-id-intake`.
7. Run `npm run build` inside `server/thai-id-intake`.

## Kafka Install Behavior

Kafka should be pinned for reproducibility:

```text
Scala version: 2.13
Kafka version: 4.3.1
Final folder: server/kafka_2.13-4.3.1/
```

Kafka install should be idempotent:

- If `server/kafka_2.13-4.3.1/bin/kafka-server-start.sh` exists, skip Kafka download/extract.
- If a cached Kafka tarball exists, reuse it.
- Download into a cache/temp location, not directly into the final Kafka folder.
- Extract into a temporary folder first.
- Move into `server/kafka_2.13-4.3.1/` only after extraction succeeds.
- If `server/kafka_2.13-4.3.1/` exists but looks incomplete or broken, stop with a clear message and ask the operator to remove or fix it manually.

This avoids wasting space or overwriting an already-seated Kafka install.

## PM2 Startup Behavior

`server/START_SERVER_PM2.sh` should:

1. Read `server.env`.
2. Require `java`, `node`, `python3`, `bash`, and `pm2`.
3. Refuse to start with a clear message if Kafka, `node_modules`, or required build outputs are missing.
4. Tell the operator to run `bash INSTALL_SERVER_DEPS.sh` when setup is incomplete.
5. Configure Kafka `listeners` and `advertised.listeners` from `SERVER_IP` and `KAFKA_PORT`.
6. Format Kafka storage only when needed.
7. Manage UFW ports only when UFW is active and `MANAGE_UFW_RULES=true`.
8. Start these PM2 apps:
   - `thai-id-kafka`
   - `thai-id-backend`
   - `thai-id-nurse-webapp`
   - `thai-id-station-display`
9. Print the backend, nurse webapp, station display, and Kafka broker addresses.

## PM2 Stop Behavior

`server/STOP_SERVER_PM2.sh` should:

- Stop the four PM2 apps.
- Remove only UFW rules recorded by this bundle.
- Leave Kafka, app source, `node_modules`, and build output in place.

## Operator Notes

- The target server needs outbound access to the npm registry and the Kafka download host.
- Re-run `INSTALL_SERVER_DEPS.sh` after changing `SERVER_IP`, frontend ports, or frontend environment values because Vite bakes those values into the built JavaScript.
- Re-running `INSTALL_SERVER_DEPS.sh` should be safe. Kafka should be skipped when already installed; `npm ci` may refresh `node_modules` based on `package-lock.json`.
- The existing `deploy-transfer/reader-agent` remains the recommended Windows reader PC package.

