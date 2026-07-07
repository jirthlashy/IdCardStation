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
  defaultStationId: env.STATION_ID,
  allowedStationIds: env.ALLOWED_STATION_IDS ?? [env.STATION_ID],
  maxQueueDepthPerStation: env.MAX_QUEUE_DEPTH_PER_STATION,
  scanRequestRateLimitWindowMs: env.SCAN_REQUEST_RATE_LIMIT_WINDOW_MS,
  scanRequestRateLimitMax: env.SCAN_REQUEST_RATE_LIMIT_MAX,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS
};

export function isAllowedStationId(stationId: string): boolean {
  return backendConfig.allowedStationIds.includes(stationId);
}
