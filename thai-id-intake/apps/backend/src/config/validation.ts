import { z } from "zod";

const requiredString = z.string().trim().min(1);
const optionalString = z.string().trim().min(1).optional();

export const backendEnvSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),
  BACKEND_HOST: z.string().trim().min(1).default("0.0.0.0"),
  KAFKA_BROKERS: z
    .string()
    .trim()
    .min(1)
    .default("localhost:9092")
    .transform((value) => value.split(",").map((broker) => broker.trim()).filter(Boolean)),
  SCAN_REQUEST_TTL_SECONDS: z.coerce.number().int().positive().default(90),
  STATION_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(3000),
  QUEUED_REQUEST_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),
  READER_HEARTBEAT_MS: z.coerce.number().int().positive().default(10000),
  RESULT_AUTO_CLEAR_SECONDS: z.coerce.number().int().positive().default(120),
  STATION_ID: z.string().trim().min(1).default("A01")
});

export type BackendEnv = z.infer<typeof backendEnvSchema>;

export const createScanRequestInputSchema = z.object({
  nurseId: requiredString,
  deviceSessionId: optionalString,
  stationId: requiredString
});

export const rejectionReasonSchema = z.enum(["wrong_patient", "not_mine", "cancel", "other"]);

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

export const thaiIdCardPayloadSchema = z
  .object({
    citizenId: requiredString,
    titleTh: z.string().optional(),
    titleEn: z.string().optional(),
    fullNameTh: z.string().optional(),
    fullNameEn: z.string().optional(),
    firstNameTh: z.string().optional(),
    firstNameEn: z.string().optional(),
    lastNameTh: z.string().optional(),
    lastNameEn: z.string().optional(),
    dateOfBirth: z.string().optional(),
    gender: z.string().optional(),
    cardIssuer: z.string().optional(),
    issueDate: z.string().optional(),
    expireDate: z.string().optional(),
    address: z.string().optional(),
    photoAsBase64Uri: z.string().optional()
  })
  .passthrough();

export const readerCardReadEventSchema = kafkaEnvelopeBaseSchema.extend({
  eventType: z.literal("reader.card_read.completed"),
  payload: z
    .object({
      requestId: requiredString,
      stationId: requiredString,
      readerId: requiredString,
      source: z.enum(["PCSC_THAI_ID", "OCR_FALLBACK"]),
      readAt: requiredString,
      card: thaiIdCardPayloadSchema
    })
    .passthrough()
});

export const readerStatusEventSchema = kafkaEnvelopeBaseSchema.extend({
  eventType: z.literal("reader.status.updated"),
  payload: z
    .object({
      stationId: requiredString,
      readerId: requiredString,
      state: requiredString,
      readerReady: z.boolean().optional(),
      activeRequestId: z.string().optional(),
      turnCode: z.string().optional(),
      message: z.string().optional(),
      updatedAt: requiredString
    })
    .passthrough()
});

export const scanRejectedEventSchema = kafkaEnvelopeBaseSchema.extend({
  eventType: z.literal("scan.rejected"),
  payload: z
    .object({
      requestId: requiredString,
      stationId: requiredString,
      deviceSessionId: requiredString,
      reason: rejectionReasonSchema,
      rejectedAt: requiredString
    })
    .passthrough()
});

export function parseBackendEnv(env: NodeJS.ProcessEnv = process.env): BackendEnv {
  const result = backendEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid backend environment: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseKafkaJson<T>(schema: z.ZodType<T>, value: Buffer): T | undefined {
  try {
    return schema.parse(JSON.parse(value.toString()));
  } catch (error) {
    console.warn(`[backend] ignored invalid Kafka message: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
