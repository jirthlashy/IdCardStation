import { z } from "zod";

const requiredString = z.string().trim().min(1);
const safeTopicSuffix = z.string().trim().regex(/^[A-Za-z0-9._-]{1,80}$/);

export const readerEnvSchema = z.object({
  STATION_ID: safeTopicSuffix.default("A01"),
  KAFKA_BROKERS: z
    .string()
    .trim()
    .min(1)
    .default("localhost:9092")
    .transform((value) => value.split(",").map((broker) => broker.trim()).filter(Boolean)),
  INSERT_CARD_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
  READ_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  READER_HEARTBEAT_MS: z.coerce.number().int().positive().default(10000),
  ENABLE_DEMO_COMMANDS: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((value) => value === "true" || value === "1" || value === "yes"),
  READER_ID: z.string().trim().min(1).optional()
});

export type ReaderEnv = z.infer<typeof readerEnvSchema>;

const scanRequestPayloadSchema = z
  .object({
    requestId: requiredString,
    nurseId: requiredString,
    deviceSessionId: requiredString,
    stationId: requiredString,
    turnCode: requiredString,
    status: requiredString,
    createdAt: requiredString,
    activatedAt: z.string().optional(),
    expiresAt: z.string().optional()
  })
  .passthrough();

const kafkaEnvelopeBaseSchema = z.object({
  eventId: requiredString,
  eventType: requiredString,
  version: z.literal(1),
  occurredAt: requiredString,
  correlationId: requiredString,
  requestId: z.string().optional(),
  stationId: z.string().optional(),
  deviceSessionId: z.string().optional()
});

export const scanRequestCreatedEventSchema = kafkaEnvelopeBaseSchema.extend({
  eventType: z.literal("scan.request.created"),
  payload: scanRequestPayloadSchema
});

export const stationStatusEventSchema = kafkaEnvelopeBaseSchema.extend({
  eventType: z.literal("station.status.updated"),
  payload: z.object({
    stationId: requiredString,
    status: requiredString,
    turnCode: z.string().optional(),
    expiresAt: z.string().optional(),
    cooldownUntil: z.string().optional(),
    queueDepth: z.number(),
    message: z.string().optional(),
    updatedAt: requiredString
  })
});

export function parseReaderEnv(env: NodeJS.ProcessEnv = process.env): ReaderEnv {
  const result = readerEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid reader-agent environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseKafkaJson<T>(schema: z.ZodType<T>, value: Buffer): T | undefined {
  try {
    return schema.parse(JSON.parse(value.toString()));
  } catch (error) {
    console.warn(`[reader-agent] ignored invalid Kafka message: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
