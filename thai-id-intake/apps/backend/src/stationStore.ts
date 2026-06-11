import {
  isReaderReadyState,
  ReaderStatusEvent,
  ScanRequest,
  StationLifecycleStatus,
  StationReadiness
} from "@thai-id-intake/shared-types";
import { backendConfig } from "./config.js";
import { nowIso } from "./events.js";

export type StationRuntime = {
  stationId: string;
  queue: ScanRequest[];
  activeRequestId?: string;
  cooldownUntil?: string;
  cooldownTimer?: NodeJS.Timeout;
};

export const requests = new Map<string, ScanRequest>();
export const stations = new Map<string, StationRuntime>();
export const lastReaderStatusByStation = new Map<string, ReaderStatusEvent["payload"]>();

export function getStation(stationId: string): StationRuntime {
  const existing = stations.get(stationId);
  if (existing) return existing;
  const station = { stationId, queue: [] };
  stations.set(stationId, station);
  return station;
}

export function getActiveRequest(station: StationRuntime): ScanRequest | undefined {
  return station.activeRequestId ? requests.get(station.activeRequestId) : undefined;
}

export function getStationStatus(station: StationRuntime): StationLifecycleStatus {
  const active = getActiveRequest(station);
  if (station.cooldownUntil && Date.parse(station.cooldownUntil) > Date.now()) return "cooldown";
  if (active?.status === "reading") return "reading";
  if (active?.status === "active" || active?.status === "retryable_error") return "active";
  if (station.queue.length > 0) return "queued";
  return "neutral";
}

export function getStationReadiness(stationId: string): StationReadiness {
  const station = getStation(stationId);
  const active = getActiveRequest(station);
  const reader = lastReaderStatusByStation.get(stationId);
  const lastReaderSeenAt = reader?.updatedAt;
  const readerAlive = Boolean(lastReaderSeenAt && Date.now() - Date.parse(lastReaderSeenAt) <= backendConfig.readerHeartbeatMs * 2.5);
  const readerReady = Boolean(readerAlive && (reader?.readerReady ?? (reader?.state ? isReaderReadyState(reader.state) : false)));
  const status = getStationStatus(station);

  return {
    stationId,
    readerAlive,
    readerReady,
    lastReaderSeenAt,
    activeRequestId: active?.requestId,
    activeTurnCode: active?.turnCode,
    activeExpiresAt: active?.expiresAt,
    cooldownUntil: station.cooldownUntil,
    queueDepth: station.queue.length,
    canRequestScan: readerReady,
    status,
    message: readerReady ? (status === "neutral" ? "Station ready" : "Station available") : "Reader offline or not ready",
    updatedAt: nowIso()
  };
}
