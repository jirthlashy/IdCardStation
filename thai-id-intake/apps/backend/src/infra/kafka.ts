import { KAFKA_TOPICS, ReaderStatusEvent, ScanRejectedEvent } from "@thai-id-intake/shared-types";
import { backendConfig } from "../config/config.js";
import { parseKafkaJson, readerCardReadEventSchema, readerStatusEventSchema, scanRejectedEventSchema } from "../config/validation.js";
import { audit } from "../audit/audit.js";
import { nowIso } from "../events/events.js";
import { consumer, ensureTopics, producer } from "./kafkaClient.js";
import { handleCardRead } from "../services/cardReadHandler.js";
import { emitRequestStatus, emitStationEvent } from "./sse.js";
import { getStationReadiness, lastReaderStatusByStation, requests } from "../station/stationStore.js";
import { publishStationStatus } from "../station/stationLifecycle.js";

export async function startKafka() {
  await ensureTopics();
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.readerCardRead, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.scanRejections, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.readerStatus(backendConfig.defaultStationId), fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      if (topic === KAFKA_TOPICS.readerCardRead) {
        const parsed = parseKafkaJson(readerCardReadEventSchema, message.value);
        if (!parsed) return;
        await handleCardRead(parsed);
      }
      if (topic === KAFKA_TOPICS.scanRejections) {
        const rejected = parseKafkaJson(scanRejectedEventSchema, message.value) as ScanRejectedEvent | undefined;
        if (!rejected) return;
        await audit({ action: rejected.payload.reason === "cancel" ? "scan_canceled" : "scan_rejected", ...rejected.payload, occurredAt: nowIso() });
      }
      if (topic === KAFKA_TOPICS.readerStatus(backendConfig.defaultStationId)) {
        const readerStatus = parseKafkaJson(readerStatusEventSchema, message.value) as ReaderStatusEvent | undefined;
        if (!readerStatus) return;
        lastReaderStatusByStation.set(readerStatus.payload.stationId, readerStatus.payload);
        emitStationEvent(readerStatus.payload.stationId, { kind: "reader", payload: readerStatus.payload });
        emitStationEvent(readerStatus.payload.stationId, { kind: "readiness", payload: getStationReadiness(readerStatus.payload.stationId) });

        if (readerStatus.payload.state === "read_failed_retryable" && readerStatus.payload.activeRequestId) {
          const request = requests.get(readerStatus.payload.activeRequestId);
          if (request && request.status !== "expired" && request.status !== "fulfilled") {
            request.status = "retryable_error";
            emitRequestStatus(request);
            await publishStationStatus(request.stationId, "active", "Read failed, reinsert card", request);
            await audit({ action: "read_error", requestId: request.requestId, stationId: request.stationId, deviceSessionId: request.deviceSessionId, occurredAt: nowIso(), metadata: { retryable: true } });
          }
        }
      }
    }
  });
}
