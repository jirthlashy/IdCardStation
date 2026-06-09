import cors from "cors";
import express from "express";
import { EventEmitter } from "node:events";
import { Kafka, Partitioners } from "kafkajs";
import { customAlphabet, nanoid } from "nanoid";
import {
  AuditEvent,
  CreateScanRequestInput,
  KAFKA_TOPICS,
  PrivateScanResult,
  ReaderCardReadEvent,
  ReaderStatusEvent,
  ScanRejectedEvent,
  ScanRequest,
  ScanRejection,
  StationLifecycleStatus,
  StationStatusEvent
} from "@thai-id-intake/shared-types";

const port = Number(process.env.BACKEND_PORT ?? 3001);
const host = process.env.BACKEND_HOST ?? "0.0.0.0";
const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const ttlSeconds = Number(process.env.SCAN_REQUEST_TTL_SECONDS ?? 90);
const cooldownMs = Number(process.env.STATION_COOLDOWN_MS ?? 3000);
const defaultStationId = process.env.STATION_ID ?? "A01";
const turnCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

type StationRuntime = {
  stationId: string;
  queue: ScanRequest[];
  activeRequestId?: string;
  cooldownUntil?: string;
  cooldownTimer?: NodeJS.Timeout;
};

const kafka = new Kafka({ clientId: "thai-id-intake-backend", brokers });
const admin = kafka.admin();
const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
const consumer = kafka.consumer({ groupId: "thai-id-intake-backend" });
const app = express();
const requests = new Map<string, ScanRequest>();
const stations = new Map<string, StationRuntime>();
const lastStationEvents = new Map<string, unknown[]>();
const privateResults = new EventEmitter();
const stationEvents = new EventEmitter();
privateResults.setMaxListeners(500);
stationEvents.setMaxListeners(500);

app.use(cors());
app.use(express.json());

function nowIso(): string {
  return new Date().toISOString();
}

function envelope<TPayload>(args: {
  eventType: any;
  payload: TPayload;
  requestId?: string;
  stationId?: string;
  deviceSessionId?: string;
  correlationId?: string;
}) {
  return {
    eventId: nanoid(),
    version: 1,
    occurredAt: nowIso(),
    correlationId: args.correlationId ?? nanoid(),
    eventType: args.eventType,
    requestId: args.requestId,
    stationId: args.stationId,
    deviceSessionId: args.deviceSessionId,
    payload: args.payload
  };
}

function getStation(stationId: string): StationRuntime {
  const existing = stations.get(stationId);
  if (existing) return existing;
  const station = { stationId, queue: [] };
  stations.set(stationId, station);
  return station;
}

function getActiveRequest(station: StationRuntime): ScanRequest | undefined {
  return station.activeRequestId ? requests.get(station.activeRequestId) : undefined;
}

function activateRequest(request: ScanRequest) {
  request.status = "active";
  request.activatedAt = nowIso();
  request.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

async function publishJson(topic: string, value: unknown, key?: string) {
  await producer.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }]
  });
}

async function audit(event: AuditEvent) {
  await publishJson(
    KAFKA_TOPICS.auditScanEvents,
    envelope({
      eventType: "audit.scan_event",
      payload: event,
      requestId: event.requestId,
      stationId: event.stationId,
      deviceSessionId: event.deviceSessionId
    }),
    event.requestId
  );
}

async function publishStationStatus(stationId: string, status: StationLifecycleStatus, message?: string, request?: ScanRequest) {
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
  const event = { kind: "station", payload };
  lastStationEvents.set(stationId, [event, ...(lastStationEvents.get(stationId) ?? []).filter((item: any) => item.kind !== "station")]);
  stationEvents.emit(stationId, event);
}

async function activateNextRequest(stationId: string) {
  const station = getStation(stationId);
  if (station.cooldownUntil && Date.parse(station.cooldownUntil) > Date.now()) return;
  if (station.activeRequestId) return;

  while (station.queue.length > 0) {
    const next = station.queue.shift();
    if (!next) return;
    if (next.status === "queued") {
      activateRequest(next);
      station.activeRequestId = next.requestId;
      await publishJson(KAFKA_TOPICS.scanRequests, envelope({ eventType: "scan.request.created", payload: next, requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId }), stationId);
      await publishStationStatus(stationId, "active", "Waiting for card", next);
      await audit({ action: "code_activated", requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId, occurredAt: nowIso() });
      return;
    }
    next.status = "expired";
    await audit({ action: "scan_expired", requestId: next.requestId, stationId, deviceSessionId: next.deviceSessionId, occurredAt: nowIso() });
  }

  await publishStationStatus(stationId, "neutral", "Ready for next scan request");
}

async function startCooldown(stationId: string) {
  const station = getStation(stationId);
  station.activeRequestId = undefined;
  station.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
  await publishStationStatus(stationId, "cooldown", "Scan complete. Remove card and wait for next code.");

  if (station.cooldownTimer) clearTimeout(station.cooldownTimer);
  station.cooldownTimer = setTimeout(() => {
    station.cooldownUntil = undefined;
    station.cooldownTimer = undefined;
    void activateNextRequest(stationId);
  }, cooldownMs);
}

function expireOldRequests() {
  const now = Date.now();
  for (const request of requests.values()) {
    if ((request.status === "active" || request.status === "reading") && request.expiresAt && Date.parse(request.expiresAt) <= now) {
      request.status = "expired";
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

app.get("/health", (_req, res) => {
  res.json({ ok: true, kafkaBrokers: brokers });
});

app.post("/api/scan-requests", async (req, res) => {
  const input = req.body as CreateScanRequestInput;
  if (!input.nurseId || !input.stationId) {
    res.status(400).json({ error: "nurseId and stationId are required" });
    return;
  }

  const station = getStation(input.stationId);
  const canActivateNow = !station.activeRequestId && (!station.cooldownUntil || Date.parse(station.cooldownUntil) <= Date.now());
  const request: ScanRequest = {
    requestId: nanoid(),
    nurseId: input.nurseId,
    deviceSessionId: input.deviceSessionId ?? nanoid(),
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
    await audit({ action: "code_activated", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  } else {
    station.queue.push(request);
    await publishStationStatus(request.stationId, "queued", "Request queued for station", getActiveRequest(station));
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

async function handleCardRead(event: ReaderCardReadEvent) {
  const read = event.payload;
  const request = requests.get(read.requestId);
  const station = getStation(read.stationId);
  if (!request || station.activeRequestId !== read.requestId || request.status === "expired" || !request.expiresAt || Date.parse(request.expiresAt) <= Date.now()) {
    await audit({ action: "misrouted", requestId: read.requestId, stationId: read.stationId, occurredAt: nowIso(), metadata: { reason: "unknown_expired_or_inactive_request" } });
    return;
  }

  request.status = "reading";
  await publishStationStatus(request.stationId, "reading", "Reading card", request);

  request.status = "fulfilled";
  const result: PrivateScanResult = {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    deliveredAt: nowIso(),
    card: read.card
  };
  await publishJson(KAFKA_TOPICS.privateScanResult(request.deviceSessionId), envelope({ eventType: "scan.result.private", payload: result, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.deviceSessionId);
  privateResults.emit(request.deviceSessionId, result);
  await publishStationStatus(request.stationId, "delivered", "Scan delivered privately", request);
  await audit({ action: "card_scan_received", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  await audit({ action: "result_delivered", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  await startCooldown(request.stationId);
}

async function ensureTopics() {
  await admin.connect();
  try {
    const existingTopics = new Set(await admin.listTopics());
    const topics = [
      { topic: KAFKA_TOPICS.scanRequests, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerCardRead, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.scanRejections, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.stationStatus(defaultStationId), numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerStatus(defaultStationId), numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.auditScanEvents, numPartitions: 1, replicationFactor: 1 }
    ].filter(({ topic }) => !existingTopics.has(topic));

    if (topics.length === 0) return;

    await admin.createTopics({
      waitForLeaders: true,
      topics
    });
  } finally {
    await admin.disconnect();
  }
}

async function startKafka() {
  await ensureTopics();
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.readerCardRead, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.scanRejections, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.readerStatus(defaultStationId), fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      const parsed = JSON.parse(message.value.toString());
      if (topic === KAFKA_TOPICS.readerCardRead) {
        await handleCardRead(parsed as ReaderCardReadEvent);
      }
      if (topic === KAFKA_TOPICS.scanRejections) {
        const rejected = parsed as ScanRejectedEvent;
        await audit({ action: rejected.payload.reason === "cancel" ? "scan_canceled" : "scan_rejected", ...rejected.payload, occurredAt: nowIso() });
      }
      if (topic === KAFKA_TOPICS.readerStatus(defaultStationId)) {
        const readerStatus = parsed as ReaderStatusEvent;
        const event = { kind: "reader", payload: readerStatus.payload };
        lastStationEvents.set(readerStatus.payload.stationId, [event, ...(lastStationEvents.get(readerStatus.payload.stationId) ?? []).filter((item: any) => item.kind !== "reader")]);
        stationEvents.emit(readerStatus.payload.stationId, event);
      }
    }
  });
}

setInterval(expireOldRequests, 1_000);

await startKafka();
await publishStationStatus(defaultStationId, "neutral", "Ready for next scan request");
app.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port}`);
});
