import cors from "cors";
import express from "express";
import { backendConfig } from "./config.js";
import { emitStationEvent } from "./sse.js";
import { startKafka } from "./kafka.js";
import { registerRoutes } from "./routes.js";
import { expireOldRequests, publishStationStatus } from "./stationLifecycle.js";
import { getStationReadiness, stations } from "./stationStore.js";

const app = express();

app.use(cors());
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
