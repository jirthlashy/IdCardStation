import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBackendEnv, parseStationRegistry, StationConfig } from "./validation.js";

const env = parseBackendEnv();
const configuredStations = loadConfiguredStations(env.STATIONS_CONFIG_PATH, env.ALLOWED_STATION_IDS ?? [env.STATION_ID]);
const allowedStationIds = configuredStations.map((station) => station.stationId);

export const backendConfig = {
  port: env.BACKEND_PORT,
  host: env.BACKEND_HOST,
  brokers: env.KAFKA_BROKERS,
  ttlSeconds: env.SCAN_REQUEST_TTL_SECONDS,
  cooldownMs: env.STATION_COOLDOWN_MS,
  queuedRequestMaxAgeSeconds: env.QUEUED_REQUEST_MAX_AGE_SECONDS,
  readerHeartbeatMs: env.READER_HEARTBEAT_MS,
  resultAutoClearSeconds: env.RESULT_AUTO_CLEAR_SECONDS,
  defaultStationId: allowedStationIds.includes(env.STATION_ID) ? env.STATION_ID : allowedStationIds[0],
  stations: configuredStations,
  allowedStationIds,
  maxQueueDepthPerStation: env.MAX_QUEUE_DEPTH_PER_STATION,
  scanRequestRateLimitWindowMs: env.SCAN_REQUEST_RATE_LIMIT_WINDOW_MS,
  scanRequestRateLimitMax: env.SCAN_REQUEST_RATE_LIMIT_MAX,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS
};

export function isAllowedStationId(stationId: string): boolean {
  return backendConfig.allowedStationIds.includes(stationId);
}

function loadConfiguredStations(configPath: string | undefined, fallbackStationIds: string[]): StationConfig[] {
  if (!configPath) {
    return Array.from(new Set(fallbackStationIds)).map((stationId) => ({ stationId, label: stationId }));
  }

  const resolvedPath = resolve(process.cwd(), configPath);
  const raw = readFileSync(resolvedPath, "utf8");
  return parseStationRegistry(JSON.parse(raw));
}
