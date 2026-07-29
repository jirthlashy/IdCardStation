# Server Deployment Script Sources

These files are the tracked source for the ignored deployment bundles.

- `full/` contains the PM2 lifecycle scripts for `deploy-transfer/server/`.
- `lite/` contains the install and PM2 lifecycle scripts for
  `deploy-transfer-lite/server/`.

Do not add Kafka, built application output, `node_modules`, or machine-local
server configuration here. Those remain generated deployment artifacts.
