import { customAlphabet, nanoid } from "nanoid";
import { CreateScanRequestInput, CreateScanRequestResponse, KAFKA_TOPICS, ScanRejection, ScanRequest } from "@thai-id-intake/shared-types";
import { audit } from "../audit/audit.js";
import { envelope, nowIso } from "../events/events.js";
import { publishJson } from "../infra/kafkaClient.js";
import { emitRequestStatus } from "../infra/sse.js";
import { getActiveRequest, getStation, getStationReadiness, requests } from "../station/stationStore.js";
import { activateNextRequest, activateRequest, publishStationStatus } from "../station/stationLifecycle.js";

const makeTurnCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

type ScanServiceDeps = {
  activateNextRequest: typeof activateNextRequest;
  audit: typeof audit;
  emitRequestStatus: typeof emitRequestStatus;
  id: () => string;
  publishJson: typeof publishJson;
  publishStationStatus: typeof publishStationStatus;
  turnCode: () => string;
};

const defaultDeps: ScanServiceDeps = {
  activateNextRequest,
  audit,
  emitRequestStatus,
  id: nanoid,
  publishJson,
  publishStationStatus,
  turnCode: makeTurnCode
};

export async function createScanRequest(input: CreateScanRequestInput, deps: ScanServiceDeps = defaultDeps): Promise<CreateScanRequestResponse> {
  const station = getStation(input.stationId);
  const readiness = getStationReadiness(input.stationId);
  const canActivateNow = readiness.readerReady && !station.activeRequestId && (!station.cooldownUntil || Date.parse(station.cooldownUntil) <= Date.now());
  const request: ScanRequest = {
    requestId: deps.id(),
    nurseId: input.nurseId,
    deviceSessionId: input.deviceSessionId ?? deps.id(),
    stationId: input.stationId,
    turnCode: deps.turnCode(),
    status: canActivateNow ? "active" : "queued",
    createdAt: nowIso()
  };

  if (canActivateNow) activateRequest(request);
  requests.set(request.requestId, request);
  await deps.audit({ action: "request_created", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });

  if (canActivateNow) {
    station.activeRequestId = request.requestId;
    await deps.publishJson(KAFKA_TOPICS.scanRequests, envelope({ eventType: "scan.request.created", payload: request, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.stationId);
    await deps.publishStationStatus(request.stationId, "active", "Waiting for card", request);
    deps.emitRequestStatus(request);
    await deps.audit({ action: "code_activated", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  } else {
    station.queue.push(request);
    const active = getActiveRequest(station);
    await deps.publishStationStatus(request.stationId, active ? "active" : "queued", readiness.readerReady ? "Request queued for station" : "Reader offline; request queued", active);
    deps.emitRequestStatus(request);
  }

  return {
    requestId: request.requestId,
    deviceSessionId: request.deviceSessionId,
    stationId: request.stationId,
    turnCode: request.turnCode,
    expiresAt: request.expiresAt,
    activatedAt: request.activatedAt,
    status: request.status,
    queuePosition: request.status === "queued" ? station.queue.findIndex((queued) => queued.requestId === request.requestId) + 1 : 0
  };
}

export async function rejectScanRequest(requestId: string, reason: ScanRejection["reason"], deps: ScanServiceDeps = defaultDeps) {
  const request = requests.get(requestId);
  if (!request) return undefined;

  const station = getStation(request.stationId);
  request.status = reason === "cancel" ? "canceled" : "misrouted";
  deps.emitRequestStatus(request);
  station.queue = station.queue.filter((queued) => queued.requestId !== request.requestId);
  if (station.activeRequestId === request.requestId) station.activeRequestId = undefined;

  const payload: ScanRejection = {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    reason,
    rejectedAt: nowIso()
  };
  await deps.publishJson(KAFKA_TOPICS.scanRejections, envelope({ eventType: "scan.rejected", payload, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.requestId);
  await deps.publishStationStatus(request.stationId, reason === "cancel" ? "canceled" : "misrouted", reason === "cancel" ? "Current scan request canceled" : "Scan marked wrong patient", request);
  await deps.audit({ action: reason === "cancel" ? "scan_canceled" : "scan_rejected", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  if (reason === "cancel") await deps.activateNextRequest(request.stationId);

  return { ok: true, status: request.status };
}
