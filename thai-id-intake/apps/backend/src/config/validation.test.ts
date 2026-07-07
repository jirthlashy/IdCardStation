import { describe, expect, it } from "vitest";
import { createScanRequestInputSchema, parseBackendEnv, readerCardReadEventSchema, readerStatusEventSchema, scanRejectedEventSchema, rejectionReasonSchema } from "./validation.js";

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
        ALLOWED_STATION_IDS: "A01,A02",
        SCAN_REQUEST_TTL_SECONDS: "60",
        STATION_COOLDOWN_MS: "3000",
        QUEUED_REQUEST_MAX_AGE_SECONDS: "300",
        READER_HEARTBEAT_MS: "10000",
        RESULT_AUTO_CLEAR_SECONDS: "120"
      })
    ).toMatchObject({
      BACKEND_PORT: 4000,
      KAFKA_BROKERS: ["localhost:9092", "localhost:9093"],
      ALLOWED_STATION_IDS: ["A01", "A02"]
    });

    expect(() => parseBackendEnv({ BACKEND_PORT: "-1" })).toThrow("Invalid backend environment");
    expect(() => parseBackendEnv({ ALLOWED_STATION_IDS: "A01,bad/topic" })).toThrow("Invalid backend environment");
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

  it("rejects client-provided device sessions on scan creation", () => {
    expect(() => createScanRequestInputSchema.parse({ nurseId: "nurse-1", stationId: "A01", deviceSessionId: "client-session" })).toThrow();
  });

  it("strips unknown reader status fields before public station SSE", () => {
    const parsed = readerStatusEventSchema.parse({
      ...envelope,
      eventType: "reader.status.updated",
      payload: {
        stationId: "A01",
        readerId: "A01-PC-01",
        state: "ready",
        updatedAt: "2026-06-17T00:00:00.000Z",
        citizenId: "1234567890123",
        card: { address: "secret" }
      }
    });

    expect(parsed.payload).not.toHaveProperty("citizenId");
    expect(parsed.payload).not.toHaveProperty("card");
  });

  it("strips unknown rejection fields before audit mapping", () => {
    const parsed = scanRejectedEventSchema.parse({
      ...envelope,
      eventType: "scan.rejected",
      payload: {
        requestId: "req-1",
        stationId: "A01",
        deviceSessionId: "device-1",
        reason: "cancel",
        rejectedAt: "2026-06-17T00:00:00.000Z",
        photoAsBase64Uri: "secret"
      }
    });

    expect(parsed.payload).not.toHaveProperty("photoAsBase64Uri");
  });
});
