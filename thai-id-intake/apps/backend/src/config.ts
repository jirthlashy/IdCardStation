export const backendConfig = {
  port: Number(process.env.BACKEND_PORT ?? 3001),
  host: process.env.BACKEND_HOST ?? "0.0.0.0",
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  ttlSeconds: Number(process.env.SCAN_REQUEST_TTL_SECONDS ?? 90),
  cooldownMs: Number(process.env.STATION_COOLDOWN_MS ?? 3000),
  queuedRequestMaxAgeSeconds: Number(process.env.QUEUED_REQUEST_MAX_AGE_SECONDS ?? 300),
  readerHeartbeatMs: Number(process.env.READER_HEARTBEAT_MS ?? 10000),
  resultAutoClearSeconds: Number(process.env.RESULT_AUTO_CLEAR_SECONDS ?? 120),
  defaultStationId: process.env.STATION_ID ?? "A01"
};
