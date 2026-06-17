import { describe, expect, it } from "vitest";
import { createScanRequestInputSchema, parseBackendEnv, readerCardReadEventSchema, rejectionReasonSchema } from "./validation.js";

const envelope = {
  eventId: "evt-1",
  version: 1,
  occurredAt: "2026-06-17T00:00:00.000Z",
  correlationId: "corr-1"
};

describe("backend validation", () => {
  it("validates create scan request bodies", () => {
    expect(createScanRequestInputSchema.parse({ nurseId: "nurse-1", stationId: "A01" })).toEqual({ nurseId: "nurse-1", stationId: "A01" });
    expect(() => createScanRequestInputSchema.parse({ nurseId: "", stationId: "A01" })).toThrow();
  });

  it("validates rejection reasons", () => {
    expect(rejectionReasonSchema.parse("cancel")).toBe("cancel");
    expect(() => rejectionReasonSchema.parse("delete_everything")).toThrow();
  });

  it("coerces and validates env values", () => {
    expect(
      parseBackendEnv({
        BACKEND_PORT: "4000",
        KAFKA_BROKERS: "localhost:9092, localhost:9093",
        SCAN_REQUEST_TTL_SECONDS: "60",
        STATION_COOLDOWN_MS: "3000",
        QUEUED_REQUEST_MAX_AGE_SECONDS: "300",
        READER_HEARTBEAT_MS: "10000",
        RESULT_AUTO_CLEAR_SECONDS: "120"
      })
    ).toMatchObject({
      BACKEND_PORT: 4000,
      KAFKA_BROKERS: ["localhost:9092", "localhost:9093"]
    });

    expect(() => parseBackendEnv({ BACKEND_PORT: "-1" })).toThrow("Invalid backend environment");
  });

  it("validates reader card-read Kafka events", () => {
    expect(
      readerCardReadEventSchema.parse({
        ...envelope,
        eventType: "reader.card_read.completed",
        payload: {
          requestId: "req-1",
          stationId: "A01",
          readerId: "A01-PC-01",
          source: "PCSC_THAI_ID",
          readAt: "2026-06-17T00:00:00.000Z",
          card: { citizenId: "1234567890123" }
        }
      }).payload.card.citizenId
    ).toBe("1234567890123");

    expect(() =>
      readerCardReadEventSchema.parse({
        ...envelope,
        eventType: "reader.card_read.completed",
        payload: { requestId: "req-1" }
      })
    ).toThrow();
  });
});
