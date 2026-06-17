import { KAFKA_TOPICS, PrivateScanResult, ReaderCardReadEvent } from "@thai-id-intake/shared-types";
import { backendConfig } from "../config/config.js";
import { audit } from "../audit/audit.js";
import { envelope, nowIso } from "../events/events.js";
import { publishJson } from "../infra/kafkaClient.js";
import { emitPrivateResult, emitRequestClearRecommended, emitRequestStatus } from "../infra/sse.js";
import { getStation, requests } from "../station/stationStore.js";
import { publishStationStatus, startCooldown } from "../station/stationLifecycle.js";

export async function handleCardRead(event: ReaderCardReadEvent) {
  const read = event.payload;
  const request = requests.get(read.requestId);
  const station = getStation(read.stationId);
  if (!request || station.activeRequestId !== read.requestId || request.status === "expired" || !request.expiresAt || Date.parse(request.expiresAt) <= Date.now()) {
    await audit({ action: "misrouted", requestId: read.requestId, stationId: read.stationId, occurredAt: nowIso(), metadata: { reason: "unknown_expired_or_inactive_request" } });
    return;
  }
  if (request.status === "fulfilled" || request.status === "canceled" || request.status === "misrouted") {
    await audit({ action: "duplicate_card_read", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
    return;
  }

  request.status = "reading";
  emitRequestStatus(request);
  await publishStationStatus(request.stationId, "reading", "Reading card", request);

  request.status = "fulfilled";
  emitRequestStatus(request);
  const result: PrivateScanResult = {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    deliveredAt: nowIso(),
    card: read.card
  };
  await publishJson(KAFKA_TOPICS.privateScanResult(request.deviceSessionId), envelope({ eventType: "scan.result.private", payload: result, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.deviceSessionId);
  emitPrivateResult(request.deviceSessionId, result);
  await publishStationStatus(request.stationId, "delivered", "Scan delivered privately", request);
  await audit({ action: "card_scan_received", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  await audit({ action: "result_delivered", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  setTimeout(() => {
    emitRequestClearRecommended(request);
  }, backendConfig.resultAutoClearSeconds * 1000);
  await startCooldown(request.stationId);
}
