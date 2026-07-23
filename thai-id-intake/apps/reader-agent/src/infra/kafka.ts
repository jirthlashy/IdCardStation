import { KAFKA_TOPICS, ScanRequestCreatedEvent, StationStatusEvent } from "@thai-id-intake/shared-types";
import { readerConfig } from "../config/config.js";
import { parseKafkaJson, scanRequestCreatedEventSchema, stationStatusEventSchema } from "../config/validation.js";
import { consumer, ensureTopics, producer } from "./kafkaClient.js";
import { publishReaderHeartbeat, publishReaderStatus } from "../reader/readerStatus.js";
import { clearActiveRequest, getActiveRequest, setActiveRequest } from "../state/state.js";

export async function startKafka() {
  console.log(`[reader-agent] Connecting to Kafka brokers: ${readerConfig.brokers.join(", ")}`);
  await ensureTopics();
  console.log("[reader-agent] Kafka topics ready");
  await producer.connect();
  console.log("[reader-agent] Kafka producer connected");
  await publishReaderHeartbeat();
  console.log("[reader-agent] Initial heartbeat published");
  setInterval(() => {
    void publishReaderHeartbeat().catch((error) => {
      console.error(`[reader-agent] heartbeat publish failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, readerConfig.heartbeatMs);
  console.log("[reader-agent] Kafka heartbeat loop started");
  console.log("[reader-agent] Connecting Kafka consumer");
  await consumer.connect();
  await consumer.subscribe({ topic: KAFKA_TOPICS.scanRequests, fromBeginning: false });
  await consumer.subscribe({ topic: KAFKA_TOPICS.stationStatus(readerConfig.stationId), fromBeginning: false });
  console.log("[reader-agent] Kafka consumer subscribed");
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
  console.log("[reader-agent] Kafka consumer running");
}
