import { parseBackendEnv } from "./validation.js";

const env = parseBackendEnv();

export const backendConfig = {
  port: env.BACKEND_PORT,
  host: env.BACKEND_HOST,
  brokers: env.KAFKA_BROKERS,
  ttlSeconds: env.SCAN_REQUEST_TTL_SECONDS,
  cooldownMs: env.STATION_COOLDOWN_MS,
  queuedRequestMaxAgeSeconds: env.QUEUED_REQUEST_MAX_AGE_SECONDS,
  readerHeartbeatMs: env.READER_HEARTBEAT_MS,
  resultAutoClearSeconds: env.RESULT_AUTO_CLEAR_SECONDS,
  defaultStationId: env.STATION_ID
};
