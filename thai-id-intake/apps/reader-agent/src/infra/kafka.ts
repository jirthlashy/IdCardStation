import { KAFKA_TOPICS, ScanRequestCreatedEvent, StationStatusEvent } from "@thai-id-intake/shared-types";
import { readerConfig } from "../config/config.js";
import { parseKafkaJson, scanRequestCreatedEventSchema, stationStatusEventSchema } from "../config/validation.js";
import { consumer, ensureTopics, producer } from "./kafkaClient.js";
import { publishReaderStatus } from "../reader/readerStatus.js";
import { clearActiveRequest, getActiveRequest, setActiveRequest } from "../state/state.js";

export async function startKafka() {
  await ensureTopics();
  await producer.connect();
  setInterval(() => {
    void publishReaderStatus(getActiveRequest() ? "heartbeat" : "waiting_for_request", getActiveRequest() ? "Reader heartbeat with active request" : "Reader heartbeat");
  }, readerConfig.heartbeatMs);
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.scanRequests, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.stationStatus(readerConfig.stationId), fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;
      if (topic === KAFKA_TOPICS.scanRequests) {
        const requestEvent = parseKafkaJson(scanRequestCreatedEventSchema, message.value) as ScanRequestCreatedEvent | undefined;
        if (!requestEvent) return;
        if (requestEvent.payload.stationId !== readerConfig.stationId) return;
        setActiveRequest(requestEvent.payload);
        await publishReaderStatus("waiting_for_card", "Active request received");
      }
      if (topic === KAFKA_TOPICS.stationStatus(readerConfig.stationId)) {
        const stationEvent = parseKafkaJson(stationStatusEventSchema, message.value) as StationStatusEvent | undefined;
        if (!stationEvent) return;
        const status = stationEvent.payload.status;
        if (status === "canceled" || status === "expired" || status === "cooldown" || status === "neutral" || status === "delivered" || status === "misrouted") {
          clearActiveRequest();
          await publishReaderStatus("waiting_for_request", `Station status ${status}`);
        }
      }
    }
  });
}
