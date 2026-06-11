import { Kafka, Partitioners } from "kafkajs";
import { KAFKA_TOPICS } from "@thai-id-intake/shared-types";
import { readerConfig, readerId } from "./config.js";

const kafka = new Kafka({ clientId: `reader-agent-${readerId}`, brokers: readerConfig.brokers });

export const admin = kafka.admin();
export const producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
export const consumer = kafka.consumer({ groupId: `reader-agent-${readerId}` });

export async function publishJson(topic: string, value: unknown, key?: string) {
  await producer.send({ topic, messages: [{ key, value: JSON.stringify(value) }] });
}

export async function ensureTopics() {
  await admin.connect();
  try {
    const existingTopics = new Set(await admin.listTopics());
    const topics = [
      { topic: KAFKA_TOPICS.scanRequests, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerCardRead, numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.stationStatus(readerConfig.stationId), numPartitions: 1, replicationFactor: 1 },
      { topic: KAFKA_TOPICS.readerStatus(readerConfig.stationId), numPartitions: 1, replicationFactor: 1 }
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
