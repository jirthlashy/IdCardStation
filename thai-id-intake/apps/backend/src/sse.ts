import { EventEmitter } from "node:events";
import { Express } from "express";
import { PrivateScanResult, ReaderStatus, SafeStationStatus, ScanRequest, StationReadiness } from "@thai-id-intake/shared-types";
import { nowIso } from "./events.js";
import { requests } from "./stationStore.js";

type StationEvent =
  | { kind: "station"; payload: SafeStationStatus }
  | { kind: "reader"; payload: ReaderStatus }
  | { kind: "readiness"; payload: StationReadiness };

const privateResults = new EventEmitter();
const stationEvents = new EventEmitter();
const requestEvents = new EventEmitter();
const lastStationEvents = new Map<string, StationEvent[]>();

privateResults.setMaxListeners(500);
stationEvents.setMaxListeners(500);
requestEvents.setMaxListeners(500);

export function emitRequestStatus(request: ScanRequest) {
  requestEvents.emit(request.requestId, {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    turnCode: request.turnCode,
    status: request.status,
    activatedAt: request.activatedAt,
    expiresAt: request.expiresAt,
    updatedAt: nowIso()
  });
}

export function emitRequestClearRecommended(request: ScanRequest) {
  requestEvents.emit(request.requestId, {
    requestId: request.requestId,
    status: "fulfilled",
    clearRecommended: true,
    updatedAt: nowIso()
  });
}

export function emitPrivateResult(deviceSessionId: string, result: PrivateScanResult) {
  privateResults.emit(deviceSessionId, result);
}

export function emitStationEvent(stationId: string, event: StationEvent) {
  lastStationEvents.set(stationId, [event, ...(lastStationEvents.get(stationId) ?? []).filter((item) => item.kind !== event.kind)]);
  stationEvents.emit(stationId, event);
}

export function registerSseRoutes(app: Express) {
  app.get("/api/scan-results/:deviceSessionId/events", (req, res) => {
    const { deviceSessionId } = req.params;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ deviceSessionId })}\n\n`);

    const onResult = (payload: PrivateScanResult) => {
      res.write(`event: scan-result\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    privateResults.on(deviceSessionId, onResult);

    req.on("close", () => {
      privateResults.off(deviceSessionId, onResult);
    });
  });

  app.get("/api/scan-requests/:requestId/events", (req, res) => {
    const { requestId } = req.params;
    const request = requests.get(requestId);
    if (!request) {
      res.status(404).json({ error: "request not found" });
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
