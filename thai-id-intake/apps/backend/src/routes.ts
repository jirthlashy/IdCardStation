import { Express } from "express";
import { customAlphabet, nanoid } from "nanoid";
import { CreateScanRequestInput, KAFKA_TOPICS, ScanRejection, ScanRequest } from "@thai-id-intake/shared-types";
import { backendConfig } from "./config.js";
import { audit } from "./audit.js";
import { envelope, nowIso } from "./events.js";
import { publishJson } from "./kafkaClient.js";
import { emitRequestStatus, registerSseRoutes } from "./sse.js";
import { getActiveRequest, getStation, getStationReadiness, requests } from "./stationStore.js";
import { activateNextRequest, activateRequest, publishStationStatus } from "./stationLifecycle.js";

const turnCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

export function registerRoutes(app: Express) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kafkaBrokers: backendConfig.brokers });
  });

  app.get("/api/stations/:stationId/readiness", (req, res) => {
    res.json(getStationReadiness(req.params.stationId));
  });

  app.post("/api/scan-requests", async (req, res) => {
    const input = req.body as CreateScanRequestInput;
    if (!input.nurseId || !input.stationId) {
      res.status(400).json({ error: "nurseId and stationId are required" });
      return;
    }

    const station = getStation(input.stationId);
    const readiness = getStationReadiness(input.stationId);
    const canActivateNow = readiness.readerReady && !station.activeRequestId && (!station.cooldownUntil || Date.parse(station.cooldownUntil) <= Date.now());
    const request: ScanRequest = {
      requestId: nanoid(),
      nurseId: input.nurseId,
      deviceSessionId: nanoid(),
      stationId: input.stationId,
      turnCode: turnCode(),
      status: canActivateNow ? "active" : "queued",
      createdAt: nowIso()
    };
    if (canActivateNow) activateRequest(request);

    requests.set(request.requestId, request);
    await audit({ action: "request_created", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });

    if (canActivateNow) {
      station.activeRequestId = request.requestId;
      await publishJson(KAFKA_TOPICS.scanRequests, envelope({ eventType: "scan.request.created", payload: request, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.stationId);
      await publishStationStatus(request.stationId, "active", "Waiting for card", request);
      emitRequestStatus(request);
      await audit({ action: "code_activated", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
    } else {
      station.queue.push(request);
      const active = getActiveRequest(station);
      await publishStationStatus(request.stationId, active ? "active" : "queued", readiness.readerReady ? "Request queued for station" : "Reader offline; request queued", active);
      emitRequestStatus(request);
    }

    res.status(201).json({
      requestId: request.requestId,
      deviceSessionId: request.deviceSessionId,
      stationId: request.stationId,
      turnCode: request.turnCode,
      expiresAt: request.expiresAt,
      activatedAt: request.activatedAt,
      status: request.status,
      queuePosition: request.status === "queued" ? station.queue.findIndex((queued) => queued.requestId === request.requestId) + 1 : 0
    });
  });

  app.post("/api/scan-requests/:requestId/rejections", async (req, res) => {
    const request = requests.get(req.params.requestId);
    if (!request) {
      res.status(404).json({ error: "request not found" });
      return;
    }

    const reason: ScanRejection["reason"] = req.body?.reason ?? "wrong_patient";
    const station = getStation(request.stationId);
    request.status = reason === "cancel" ? "canceled" : "misrouted";
    emitRequestStatus(request);
    station.queue = station.queue.filter((queued) => queued.requestId !== request.requestId);
    if (station.activeRequestId === request.requestId) station.activeRequestId = undefined;

    const payload: ScanRejection = {
      requestId: request.requestId,
      stationId: request.stationId,
      deviceSessionId: request.deviceSessionId,
      reason,
      rejectedAt: nowIso()
    };
    await publishJson(KAFKA_TOPICS.scanRejections, envelope({ eventType: "scan.rejected", payload, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.requestId);
    await publishStationStatus(request.stationId, reason === "cancel" ? "canceled" : "misrouted", reason === "cancel" ? "Current scan request canceled" : "Scan marked wrong patient", request);
    await audit({ action: reason === "cancel" ? "scan_canceled" : "scan_rejected", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
    if (reason === "cancel") await activateNextRequest(request.stationId);
    res.json({ ok: true, status: request.status });
  });

  registerSseRoutes(app);
}
