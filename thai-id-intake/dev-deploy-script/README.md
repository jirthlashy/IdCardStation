# Development Deployment Scripts

This directory is the tracked development source for deployment behavior. It
is not itself a deployable server or reader package.

Use it to change, review, and version the scripts that are copied into the
ignored operator-facing bundles at the repository root:

```text
deploy-transfer/        # Full offline bundle
deploy-transfer-lite/   # Lite online-install bundle
```

## Contents

- `reader-agent/windows/` contains the shared Windows reader launcher scripts
  and the lite-only first-run installer.
- `server/full/` contains the PM2 start/stop scripts for the full offline
  Ubuntu server bundle.
- `server/lite/` contains the installer and PM2 scripts for the lite Ubuntu
  server bundle.

## Workflow

1. Edit deployment scripts here, not inside either generated bundle.
2. Run `npm run sync:reader-launcher` from `thai-id-intake/` to refresh the
   full and lite reader folders from `reader-agent/windows/`.
3. Copy or package the server scripts into the appropriate generated server
   folder when preparing a release.
4. Test the generated bundle, not this source directory, on the target OS.

Do not add Kafka, built application output, `node_modules`, portable Node
runtime files, logs, PID files, `reader.env`, or card data here. Those are
generated or machine-local deployment artifacts and remain ignored by Git.
