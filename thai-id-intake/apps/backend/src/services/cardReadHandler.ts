import { KAFKA_TOPICS, PrivateScanResult, ReaderCardReadEvent } from "@thai-id-intake/shared-types";
import { backendConfig } from "../config/config.js";
import { audit } from "../audit/audit.js";
import { envelope, nowIso } from "../events/events.js";
import { publishJson } from "../infra/kafkaClient.js";
import { emitPrivateResult, emitRequestClearRecommended, emitRequestStatus } from "../infra/sse.js";
import { getStation, requests } from "../station/stationStore.js";
import { publishStationStatus, startCooldown } from "../station/stationLifecycle.js";

type CardReadHandlerDeps = {
  audit: typeof audit;
  emitPrivateResult: typeof emitPrivateResult;
  emitRequestClearRecommended: typeof emitRequestClearRecommended;
  emitRequestStatus: typeof emitRequestStatus;
  publishJson: typeof publishJson;
  publishStationStatus: typeof publishStationStatus;
  startCooldown: typeof startCooldown;
};

const defaultDeps: CardReadHandlerDeps = {
  audit,
  emitPrivateResult,
  emitRequestClearRecommended,
  emitRequestStatus,
  publishJson,
  publishStationStatus,
  startCooldown
};

export async function handleCardRead(event: ReaderCardReadEvent, deps: CardReadHandlerDeps = defaultDeps) {
  const read = event.payload;
  const request = requests.get(read.requestId);
  const station = getStation(read.stationId);
  if (!request || station.activeRequestId !== read.requestId || request.status === "expired" || !request.expiresAt || Date.parse(request.expiresAt) <= Date.now()) {
    await deps.audit({ action: "misrouted", requestId: read.requestId, stationId: read.stationId, occurredAt: nowIso(), metadata: { reason: "unknown_expired_or_inactive_request" } });
    return;
  }
  if (request.status === "fulfilled" || request.status === "canceled" || request.status === "misrouted") {
    await deps.audit({ action: "duplicate_card_read", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
    return;
  }

  request.status = "reading";
  deps.emitRequestStatus(request);
  await deps.publishStationStatus(request.stationId, "reading", "Reading card", request);

  const result: PrivateScanResult = {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    deliveredAt: nowIso(),
    card: read.card
  };
  try {
    await deps.publishJson(KAFKA_TOPICS.privateScanResult(request.deviceSessionId), envelope({ eventType: "scan.result.private", payload: result, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.deviceSessionId);
  } catch (error) {
    request.status = "failed";
    station.activeRequestId = undefined;
    deps.emitRequestStatus(request);
    await deps.publishStationStatus(request.stationId, "failed", "Private result delivery failed; rescan required", request);
    await deps.audit({ action: "read_error", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso(), metadata: { resultDeliveryFailed: true } });
    await deps.startCooldown(request.stationId);
    return;
  }

  request.status = "fulfilled";
  deps.emitRequestStatus(request);
  deps.emitPrivateResult(request.requestId, result);
  await deps.publishStationStatus(request.stationId, "delivered", "Scan delivered privately", request);
  await deps.audit({ action: "card_scan_received", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  await deps.audit({ action: "result_delivered", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  setTimeout(() => {
    deps.emitRequestClearRecommended(request);
  }, backendConfig.resultAutoClearSeconds * 1000);
  await deps.startCooldown(request.stationId);
}
