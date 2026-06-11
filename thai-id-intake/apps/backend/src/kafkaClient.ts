import { Kafka, Partitioners } from "kafkajs";
import { KAFKA_TOPICS } from "@thai-id-intake/shared-types";
import { backendConfig } from "./config.js";

const kafka = new Kafka({ clientId: "thai-id-intake-backend", brokers: backendConfig.brokers });

export const admin = kafka.admin();
export const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
export const consumer = kafka.consumer({ groupId: "thai-id-intake-backend" });

export async function publishJson(topic: string, value: unknown, key?: string) {
  await producer.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }]
  });
}

export async function ensureTopics() {
  await admin.connect();
  try {
    const existingTopics = new Set(await admin.listTopics());
    const topics = [
      { topic: KAFKA_TOPICS.scanRequests, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerCardRead, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.scanRejections, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.stationStatus(backendConfig.defaultStationId), numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerStatus(backendConfig.defaultStationId), numPartitions: 1, replicationFactor: 1 },
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
