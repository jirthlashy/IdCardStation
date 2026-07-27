import cors from "cors";
import express from "express";
import { backendConfig } from "./config/config.js";
import { emitStationEvent } from "./infra/sse.js";
import { startKafka } from "./infra/kafka.js";
import { registerRoutes } from "./http/routes.js";
import { expireOldRequests, publishStationStatus } from "./station/stationLifecycle.js";
import { getStationReadiness, stations } from "./station/stationStore.js";

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || backendConfig.corsAllowedOrigins.length === 0 || backendConfig.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin is not allowed"));
    }
  })
);
app.use(express.json());
registerRoutes(app);

setInterval(expireOldRequests, 1_000);
setInterval(() => {
  for (const stationId of new Set([...backendConfig.allowedStationIds, ...stations.keys()])) {
    emitStationEvent(stationId, { kind: "readiness", payload: getStationReadiness(stationId) });
  }
}, backendConfig.readerHeartbeatMs);

await startKafka();
for (const stationId of backendConfig.allowedStationIds) {
  await publishStationStatus(stationId, "neutral", "Ready for next scan request");
}
app.listen(backendConfig.port, backendConfig.host, () => {
  console.log(`backend listening on http://${backendConfig.host}:${backendConfig.port}`);
  printConfiguredStations();
});

function printConfiguredStations() {
  const nurseWebPort = process.env.NURSE_WEBAPP_PORT?.trim() || "3000";
  const stationDisplayPort = process.env.STATION_DISPLAY_PORT?.trim() || "3002";
  const host = backendConfig.host === "0.0.0.0" ? "localhost" : backendConfig.host;

  console.log("configured stations:");
  for (const station of backendConfig.stations) {
    console.log(`  ${station.stationId}${station.label && station.label !== station.stationId ? ` (${station.label})` : ""}`);
    console.log(`    nurse webapp:    http://${host}:${nurseWebPort}/?stationId=${station.stationId}`);
    console.log(`    station display: http://${host}:${stationDisplayPort}/?stationId=${station.stationId}`);
  }
}
