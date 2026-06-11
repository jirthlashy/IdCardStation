import { KAFKA_TOPICS, ReaderStatusEvent, ScanRejectedEvent } from "@thai-id-intake/shared-types";
import { backendConfig } from "./config.js";
import { audit } from "./audit.js";
import { nowIso } from "./events.js";
import { consumer, ensureTopics, producer } from "./kafkaClient.js";
import { handleCardRead } from "./cardReadHandler.js";
import { emitRequestStatus, emitStationEvent } from "./sse.js";
import { getStationReadiness, lastReaderStatusByStation, requests } from "./stationStore.js";
import { publishStationStatus } from "./stationLifecycle.js";

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
      const parsed = JSON.parse(message.value.toString());
      if (topic === KAFKA_TOPICS.readerCardRead) {
        await handleCardRead(parsed);
      }
      if (topic === KAFKA_TOPICS.scanRejections) {
        const rejected = parsed as ScanRejectedEvent;
        await audit({ action: rejected.payload.reason === "cancel" ? "scan_canceled" : "scan_rejected", ...rejected.payload, occurredAt: nowIso() });
      }
      if (topic === KAFKA_TOPICS.readerStatus(backendConfig.defaultStationId)) {
        const readerStatus = parsed as ReaderStatusEvent;
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
