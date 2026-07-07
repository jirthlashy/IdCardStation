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
  for (const stationId of stations.keys()) {
    emitStationEvent(stationId, { kind: "readiness", payload: getStationReadiness(stationId) });
  }
}, backendConfig.readerHeartbeatMs);

await startKafka();
await publishStationStatus(backendConfig.defaultStationId, "neutral", "Ready for next scan request");
app.listen(backendConfig.port, backendConfig.host, () => {
  console.log(`backend listening on http://${backendConfig.host}:${backendConfig.port}`);
});
