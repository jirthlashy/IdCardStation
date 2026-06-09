import { Kafka, Partitioners } from "kafkajs";
import { nanoid } from "nanoid";
import { createRequire } from "node:module";
import {
  KAFKA_TOPICS,
  ReaderCardRead,
  ReaderStatus,
  ScanRequestCreatedEvent,
  ThaiIdCardPayload
} from "@thai-id-intake/shared-types";

const require = createRequire(import.meta.url);

type SmartCardReturnData = {
  citizenID?: string;
  titleTH?: string;
  titleEN?: string;
  fullNameTH?: string;
  fullNameEN?: string;
  firstNameTH?: string;
  firstNameEN?: string;
  lastNameTH?: string;
  lastNameEN?: string;
  dateOfBirth?: string;
  gender?: string;
  cardIssuer?: string;
  issueDate?: string;
  expireDate?: string;
  address?: string;
  photoAsBase64Uri?: string;
};

const stationId = process.env.STATION_ID ?? "A01";
const readerId = process.env.READER_ID ?? `${stationId}-PC-01`;
const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",");
const insertCardDelayMs = Number(process.env.INSERT_CARD_DELAY_MS ?? 500);
const readTimeoutMs = Number(process.env.READ_TIMEOUT_MS ?? 5000);

const kafka = new Kafka({ clientId: `reader-agent-${readerId}`, brokers });
const admin = kafka.admin();
const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
const consumer = kafka.consumer({ groupId: `reader-agent-${readerId}` });
let activeRequest: ScanRequestCreatedEvent["payload"] | undefined;
let lastCitizenId = "";
let lastReadAt = 0;

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
  await producer.send({ topic, messages: [{ key, value: JSON.stringify(value) }] });
}

async function publishReaderStatus(state: ReaderStatus["state"], message?: string) {
  const payload: ReaderStatus = {
    stationId,
    readerId,
    state,
    activeRequestId: activeRequest?.requestId,
    turnCode: activeRequest?.turnCode,
    message,
    updatedAt: nowIso()
  };
  await publishJson(KAFKA_TOPICS.readerStatus(stationId), envelope({ eventType: "reader.status.updated", payload, stationId, requestId: activeRequest?.requestId }), stationId);
  console.log(`[reader-agent] ${state}${activeRequest?.turnCode ? ` code=${activeRequest.turnCode}` : ""}${message ? ` ${message}` : ""}`);
}

function normalizeCard(raw: Record<string, unknown>): ThaiIdCardPayload {
  return {
    citizenId: String(raw.citizenId ?? raw.citizenID ?? raw.cid ?? raw.personalId ?? ""),
    titleTh: raw.titleTh ? String(raw.titleTh) : raw.titleTH ? String(raw.titleTH) : undefined,
    titleEn: raw.titleEn ? String(raw.titleEn) : raw.titleEN ? String(raw.titleEN) : undefined,
    fullNameTh: raw.fullNameTh ? String(raw.fullNameTh) : raw.fullNameTH ? String(raw.fullNameTH) : undefined,
    fullNameEn: raw.fullNameEn ? String(raw.fullNameEn) : raw.fullNameEN ? String(raw.fullNameEN) : undefined,
    firstNameTh: raw.firstNameTh ? String(raw.firstNameTh) : raw.firstNameTH ? String(raw.firstNameTH) : undefined,
    firstNameEn: raw.firstNameEn ? String(raw.firstNameEn) : raw.firstNameEN ? String(raw.firstNameEN) : undefined,
    lastNameTh: raw.lastNameTh ? String(raw.lastNameTh) : raw.lastNameTH ? String(raw.lastNameTH) : undefined,
    lastNameEn: raw.lastNameEn ? String(raw.lastNameEn) : raw.lastNameEN ? String(raw.lastNameEN) : undefined,
    dateOfBirth: raw.dateOfBirth ? String(raw.dateOfBirth) : undefined,
    gender: raw.gender ? String(raw.gender) : undefined,
    cardIssuer: raw.cardIssuer ? String(raw.cardIssuer) : undefined,
    issueDate: raw.issueDate ? String(raw.issueDate) : undefined,
    expireDate: raw.expireDate ? String(raw.expireDate) : undefined,
    address: raw.address ? String(raw.address) : undefined,
    photoAsBase64Uri: raw.photoAsBase64Uri ? String(raw.photoAsBase64Uri) : undefined
  };
}

async function publishCardRead(card: ThaiIdCardPayload) {
  if (!activeRequest) {
    await publishReaderStatus("waiting_for_request", "Card read ignored because no active request exists");
    return;
  }
  if (card.citizenId === lastCitizenId && Date.now() - lastReadAt < readTimeoutMs) {
    await publishReaderStatus("ready", "Duplicate card read debounced");
    return;
  }

  lastCitizenId = card.citizenId;
  lastReadAt = Date.now();
  const payload: ReaderCardRead = {
    requestId: activeRequest.requestId,
    stationId,
    readerId,
    source: "PCSC_THAI_ID",
    readAt: nowIso(),
    card
  };
  await publishJson(KAFKA_TOPICS.readerCardRead, envelope({ eventType: "reader.card_read.completed", payload, requestId: activeRequest.requestId, stationId, deviceSessionId: activeRequest.deviceSessionId }), activeRequest.requestId);
  await publishReaderStatus("ready", "Card read sent to backend");
}

async function startSmartCardReader() {
  try {
    const { ThaiIdCardReader } = require("thai-id-card-reader/build/index.js") as {
      ThaiIdCardReader: new (options: { insertCardDelay: number; readTimeout: number }) => {
        onReadComplete: (callback: (data: Partial<SmartCardReturnData>) => void) => void;
        onReadError: (callback: (error: string) => void) => void;
        init: () => void;
      };
    };
    const reader = new ThaiIdCardReader({
      insertCardDelay: insertCardDelayMs,
      readTimeout: readTimeoutMs
    });

    reader.onReadComplete((data: Partial<SmartCardReturnData>) => {
      void publishCardRead(normalizeCard(data as Record<string, unknown>));
    });
    reader.onReadError((error: string) => {
      void publishReaderStatus("error", error);
    });
    reader.init();
    await publishReaderStatus("ready", `Thai ID reader initialized; insert delay ${insertCardDelayMs}ms`);
  } catch (error) {
    await publishReaderStatus(
      "error",
      `Thai ID reader package is installed, but native startup failed. Rebuild pcsclite before using hardware. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function ensureTopics() {
  await admin.connect();
  try {
    const existingTopics = new Set(await admin.listTopics());
    const topics = [
      { topic: KAFKA_TOPICS.scanRequests, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerCardRead, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerStatus(stationId), numPartitions: 1, replicationFactor: 1 }
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

await ensureTopics();
await producer.connect();
await consumer.connect();
await consumer.subscribe({ topic: KAFKA_TOPICS.scanRequests, fromBeginning: false });
await consumer.run({
  eachMessage: async ({ message }) => {
    if (!message.value) return;
    const event = JSON.parse(message.value.toString()) as ScanRequestCreatedEvent;
    if (event.payload.stationId !== stationId) return;
    activeRequest = event.payload;
    await publishReaderStatus("waiting_for_card", "Active request received");
  }
});

await startSmartCardReader();

process.stdin.on("data", async (chunk) => {
  const text = chunk.toString().trim();
  if (text === "demo-read") {
    await publishCardRead(normalizeCard({ citizenId: "0000000000000", fullNameTh: "DEMO ONLY" }));
  }
});
