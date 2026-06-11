import { KAFKA_TOPICS, ScanRequest, StationLifecycleStatus, StationStatusEvent } from "@thai-id-intake/shared-types";
import { backendConfig } from "./config.js";
import { nowIso, envelope } from "./events.js";
import { publishJson } from "./kafkaClient.js";
import { audit } from "./audit.js";
import { emitRequestStatus, emitStationEvent } from "./sse.js";
import { getActiveRequest, getStation, getStationReadiness, getStationStatus, requests } from "./stationStore.js";

export function activateRequest(request: ScanRequest) {
  request.status = "active";
  request.activatedAt = nowIso();
  request.expiresAt = new Date(Date.now() + backendConfig.ttlSeconds * 1000).toISOString();
}

export async function publishStationStatus(stationId: string, status: StationLifecycleStatus, message?: string, request?: ScanRequest) {
  const station = getStation(stationId);
  const active = request ?? getActiveRequest(station);
  const payload: StationStatusEvent["payload"] = {
    stationId,
    activeRequestId: active?.requestId,
    turnCode: active?.turnCode,
    status,
    expiresAt: active?.expiresAt,
    cooldownUntil: station.cooldownUntil,
    queueDepth: station.queue.length,
    message,
    updatedAt: nowIso()
  };

  await publishJson(
    KAFKA_TOPICS.stationStatus(stationId),
    envelope({
      eventType: "station.status.updated",
      requestId: active?.requestId,
      stationId,
      deviceSessionId: active?.deviceSessionId,
      payload
    }),
    stationId
  );
  emitStationEvent(stationId, { kind: "station", payload });
  emitStationEvent(stationId, { kind: "readiness", payload: getStationReadiness(stationId) });
}

export async function activateNextRequest(stationId: string) {
  const station = getStation(stationId);
  if (station.cooldownUntil && Date.parse(station.cooldownUntil) > Date.now()) return;
  if (station.activeRequestId) return;

  while (station.queue.length > 0) {
    const next = station.queue.shift();
    if (!next) return;
    if (next.status === "queued") {
      if (Date.now() - Date.parse(next.createdAt) > backendConfig.queuedRequestMaxAgeSeconds * 1000) {
        next.status = "expired";
        emitRequestStatus(next);
        await audit({ action: "scan_expired", requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId, occurredAt: nowIso(), metadata: { reason: "queued_max_age" } });
        continue;
      }
      activateRequest(next);
      station.activeRequestId = next.requestId;
      await publishJson(KAFKA_TOPICS.scanRequests, envelope({ eventType: "scan.request.created", payload: next, requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId }), stationId);
      await publishStationStatus(stationId, "active", "Waiting for card", next);
      emitRequestStatus(next);
      await audit({ action: "code_activated", requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId, occurredAt: nowIso() });
      return;
    }
    next.status = "expired";
    await audit({ action: "scan_expired", requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId, occurredAt: nowIso() });
  }

  await publishStationStatus(stationId, "neutral", "Ready for next scan request");
}

export async function startCooldown(stationId: string) {
  const station = getStation(stationId);
  station.activeRequestId = undefined;
  station.cooldownUntil = new Date(Date.now() + backendConfig.cooldownMs).toISOString();
  await publishStationStatus(stationId, "cooldown", "Scan complete. Remove card and wait for next code.");

  if (station.cooldownTimer) clearTimeout(station.cooldownTimer);
  station.cooldownTimer = setTimeout(() => {
    station.cooldownUntil = undefined;
    station.cooldownTimer = undefined;
    void activateNextRequest(stationId);
  }, backendConfig.cooldownMs);
}

export function expireOldRequests() {
  const now = Date.now();
  for (const request of requests.values()) {
    if (request.status === "queued" && now - Date.parse(request.createdAt) > backendConfig.queuedRequestMaxAgeSeconds * 1000) {
      request.status = "expired";
      emitRequestStatus(request);
      const station = getStation(request.stationId);
      station.queue = station.queue.filter((queued) => queued.requestId !== request.requestId);
      void publishStationStatus(request.stationId, getStationStatus(station), "Queued request expired before activation", getActiveRequest(station));
      void audit({
        action: "scan_expired",
        requestId: request.requestId,
        stationId: request.stationId,
        deviceSessionId: request.deviceSessionId,
        occurredAt: nowIso(),
        metadata: { reason: "queued_max_age" }
      });
    }
    if ((request.status === "active" || request.status === "reading" || request.status === "retryable_error") && request.expiresAt && Date.parse(request.expiresAt) <= now) {
      request.status = "expired";
      emitRequestStatus(request);
      const station = getStation(request.stationId);
      station.queue = station.queue.filter((queued) => queued.requestId !== request.requestId);
      if (station.activeRequestId === request.requestId) station.activeRequestId = undefined;
      void publishStationStatus(request.stationId, "expired", "Scan request expired", request);
      void audit({
        action: "scan_expired",
        requestId: request.requestId,
        stationId: request.stationId,
        deviceSessionId: request.deviceSessionId,
        occurredAt: nowIso()
      });
      void activateNextRequest(request.stationId);
    }
  }
}
