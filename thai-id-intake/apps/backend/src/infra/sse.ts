import { EventEmitter } from "node:events";
import { Express } from "express";
import { PrivateScanResult, ReaderStatus, SafeStationStatus, ScanRequest, StationReadiness } from "@thai-id-intake/shared-types";
import { nowIso } from "../events/events.js";
import { isAllowedStationId } from "../config/config.js";
import { requests, verifyRequestAccessToken } from "../station/stationStore.js";

type PublicReaderStatus = Omit<ReaderStatus, "activeRequestId">;

type StationEvent =
  | { kind: "station"; payload: SafeStationStatus }
  | { kind: "reader"; payload: PublicReaderStatus }
  | { kind: "readiness"; payload: StationReadiness };

const privateResults = new EventEmitter();
const stationEvents = new EventEmitter();
const requestEvents = new EventEmitter();
const lastStationEvents = new Map<string, StationEvent[]>();

privateResults.setMaxListeners(500);
stationEvents.setMaxListeners(500);
requestEvents.setMaxListeners(500);

export function emitRequestStatus(request: ScanRequest) {
  requestEvents.emit(request.requestId, requestStatusPayload(request));
}

export function emitRequestClearRecommended(request: ScanRequest) {
  requestEvents.emit(request.requestId, {
    requestId: request.requestId,
    status: "fulfilled",
    clearRecommended: true,
    updatedAt: nowIso()
  });
}

export function emitPrivateResult(requestId: string, result: PrivateScanResult) {
  privateResults.emit(requestId, result);
}

export function emitStationEvent(stationId: string, event: StationEvent) {
  const safeEvent = sanitizeStationEvent(event);
  lastStationEvents.set(stationId, [safeEvent, ...(lastStationEvents.get(stationId) ?? []).filter((item) => item.kind !== safeEvent.kind)]);
  stationEvents.emit(stationId, safeEvent);
}

export function registerSseRoutes(app: Express) {
  app.get("/api/scan-requests/:requestId/result-events", (req, res) => {
    const { requestId } = req.params;
    const request = requests.get(requestId);
    const accessToken = getAccessToken(req.query.accessToken);
    if (!request || !verifyRequestAccessToken(requestId, accessToken)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ requestId })}\n\n`);

    const onResult = (payload: PrivateScanResult) => {
      res.write(`event: scan-result\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    privateResults.on(requestId, onResult);

    req.on("close", () => {
      privateResults.off(requestId, onResult);
    });
  });

  app.get("/api/scan-requests/:requestId/events", (req, res) => {
    const { requestId } = req.params;
    const request = requests.get(requestId);
    const accessToken = getAccessToken(req.query.accessToken);
    if (!request || !verifyRequestAccessToken(requestId, accessToken)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ requestId })}\n\n`);

    const onStatus = (payload: unknown) => {
      res.write(`event: request-status\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    requestEvents.on(requestId, onStatus);
    emitRequestStatus(request);

    req.on("close", () => {
      requestEvents.off(requestId, onStatus);
    });
  });

  app.get("/api/stations/:stationId/status/events", (req, res) => {
    const { stationId } = req.params;
    if (!isAllowedStationId(stationId)) {
      res.status(404).json({ error: "station not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ stationId })}\n\n`);
    for (const event of lastStationEvents.get(stationId) ?? []) {
      res.write(`event: station-status\ndata: ${JSON.stringify(event)}\n\n`);
    }

    const onStatus = (event: unknown) => {
      res.write(`event: station-status\ndata: ${JSON.stringify(event)}\n\n`);
    };
    stationEvents.on(stationId, onStatus);

    req.on("close", () => {
      stationEvents.off(stationId, onStatus);
    });
  });
}

function getAccessToken(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function requestStatusPayload(request: ScanRequest) {
  return {
    requestId: request.requestId,
    stationId: request.stationId,
    turnCode: request.turnCode,
    status: request.status,
    activatedAt: request.activatedAt,
    expiresAt: request.expiresAt,
    updatedAt: nowIso()
  };
}

export function sanitizeStationEvent(event: StationEvent): StationEvent {
  if (event.kind !== "reader") return event;
  const { stationId, readerId, state, readerReady, turnCode, message, updatedAt } = event.payload;
  return { kind: "reader", payload: { stationId, readerId, state, readerReady, turnCode, message, updatedAt } };
}
