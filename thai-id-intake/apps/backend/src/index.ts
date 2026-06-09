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
  ScanRejectedEvent,
  ScanRequest,
  ScanRejection,
  StationStatusEvent
} from "@thai-id-intake/shared-types";

const port = Number(process.env.BACKEND_PORT ?? 3001);
const host = process.env.BACKEND_HOST ?? "0.0.0.0";
const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const ttlSeconds = Number(process.env.SCAN_REQUEST_TTL_SECONDS ?? 90);
const turnCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

const kafka = new Kafka({ clientId: "thai-id-intake-backend", brokers });
const admin = kafka.admin();
const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
const consumer = kafka.consumer({ groupId: "thai-id-intake-backend" });
const app = express();
const requests = new Map<string, ScanRequest>();
const privateResults = new EventEmitter();
privateResults.setMaxListeners(500);

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

async function publishStationStatus(request: ScanRequest, status: StationStatusEvent["payload"]["status"], message?: string) {
  await publishJson(
    KAFKA_TOPICS.stationStatus(request.stationId),
    envelope({
      eventType: "station.status.updated",
      requestId: request.requestId,
      stationId: request.stationId,
      payload: {
        stationId: request.stationId,
        activeRequestId: request.requestId,
        turnCode: request.turnCode,
        status,
        message,
        updatedAt: nowIso()
      }
    }),
    request.stationId
  );
}

function expireOldRequests() {
  const now = Date.now();
  for (const request of requests.values()) {
    if ((request.status === "created" || request.status === "active" || request.status === "reading") && Date.parse(request.expiresAt) <= now) {
      request.status = "expired";
      void publishStationStatus(request, "expired", "Scan request expired");
      void audit({
        action: "scan_expired",
        requestId: request.requestId,
        stationId: request.stationId,
        deviceSessionId: request.deviceSessionId,
        occurredAt: nowIso()
      });
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

  const request: ScanRequest = {
    requestId: nanoid(),
    nurseId: input.nurseId,
    deviceSessionId: input.deviceSessionId ?? nanoid(),
    stationId: input.stationId,
    turnCode: turnCode(),
    status: "active",
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
  };

  requests.set(request.requestId, request);
  await publishJson(KAFKA_TOPICS.scanRequests, envelope({ eventType: "scan.request.created", payload: request, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.stationId);
  await publishStationStatus(request, "active", "Waiting for card");
  await audit({ action: "request_created", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });

  res.status(201).json({
    requestId: request.requestId,
    deviceSessionId: request.deviceSessionId,
    stationId: request.stationId,
    turnCode: request.turnCode,
    expiresAt: request.expiresAt
  });
});

app.post("/api/scan-requests/:requestId/rejections", async (req, res) => {
  const request = requests.get(req.params.requestId);
  if (!request) {
    res.status(404).json({ error: "request not found" });
    return;
  }

  request.status = "misrouted";
  const payload: ScanRejection = {
    requestId: request.requestId,
    stationId: request.stationId,
    deviceSessionId: request.deviceSessionId,
    reason: req.body?.reason ?? "wrong_patient",
    rejectedAt: nowIso()
  };
  await publishJson(KAFKA_TOPICS.scanRejections, envelope({ eventType: "scan.rejected", payload, requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId }), request.requestId);
  await audit({ action: "scan_rejected", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
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

async function handleCardRead(event: ReaderCardReadEvent) {
  const read = event.payload;
  const request = requests.get(read.requestId);
  if (!request || request.status === "expired" || Date.parse(request.expiresAt) <= Date.now()) {
    await audit({ action: "misrouted", requestId: read.requestId, stationId: read.stationId, occurredAt: nowIso(), metadata: { reason: "unknown_or_expired_request" } });
    return;
  }

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
  await publishStationStatus(request, "idle", "Scan delivered privately");
  await audit({ action: "card_scan_received", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
  await audit({ action: "result_delivered", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso() });
}

async function ensureTopics() {
  await admin.connect();
  try {
    const existingTopics = new Set(await admin.listTopics());
    const topics = [
      { topic: KAFKA_TOPICS.scanRequests, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerCardRead, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.scanRejections, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.auditScanEvents, numPartitions: 1, replicationFactor: 1 }
    ].filter(({ topic }) => !existingTopics.has(topic));

    if (topics.length === 0) {
      return;
    }

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
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      const parsed = JSON.parse(message.value.toString());
      if (topic === KAFKA_TOPICS.readerCardRead) {
        await handleCardRead(parsed as ReaderCardReadEvent);
      }
      if (topic === KAFKA_TOPICS.scanRejections) {
        const rejected = parsed as ScanRejectedEvent;
        await audit({ action: "scan_rejected", ...rejected.payload, occurredAt: nowIso() });
      }
    }
  });
}

setInterval(expireOldRequests, 5_000);

await startKafka();
app.listen(port, host, () => {
  console.log(`backend listening on http://${host}:${port}`);
});
