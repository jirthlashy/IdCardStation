import { describe, expect, it } from "vitest";
import { parseReaderEnv, scanRequestCreatedEventSchema, stationStatusEventSchema } from "./validation.js";

const envelope = {
  eventId: "evt-1",
  version: 1,
  occurredAt: "2026-06-17T00:00:00.000Z",
  correlationId: "corr-1"
};

describe("reader-agent validation", () => {
  it("coerces and validates env values", () => {
    expect(
      parseReaderEnv({
        STATION_ID: "A02",
        KAFKA_BROKERS: "localhost:9092, localhost:9093",
        INSERT_CARD_DELAY_MS: "250",
        READ_TIMEOUT_MS: "5000",
        READER_HEARTBEAT_MS: "10000"
      })
    ).toMatchObject({
      STATION_ID: "A02",
      KAFKA_BROKERS: ["localhost:9092", "localhost:9093"],
      INSERT_CARD_DELAY_MS: 250
    });
  });

  it("keeps demo stdin commands disabled unless explicitly enabled", () => {
    expect(parseReaderEnv({}).ENABLE_DEMO_COMMANDS).toBe(false);
    expect(parseReaderEnv({ ENABLE_DEMO_COMMANDS: "true" }).ENABLE_DEMO_COMMANDS).toBe(true);
    expect(parseReaderEnv({ ENABLE_DEMO_COMMANDS: "1" }).ENABLE_DEMO_COMMANDS).toBe(true);
    expect(parseReaderEnv({ ENABLE_DEMO_COMMANDS: "yes" }).ENABLE_DEMO_COMMANDS).toBe(true);
  });

  it("rejects invalid env numbers", () => {
    expect(() => parseReaderEnv({ READ_TIMEOUT_MS: "0" })).toThrow("Invalid reader-agent environment");
    expect(() => parseReaderEnv({ STATION_ID: "bad/topic" })).toThrow("Invalid reader-agent environment");
  });

  it("uses a conservative card insert delay by default", () => {
    expect(parseReaderEnv({}).INSERT_CARD_DELAY_MS).toBe(2000);
  });

  it("validates scan request and station status Kafka events", () => {
    expect(
      scanRequestCreatedEventSchema.parse({
        ...envelope,
        eventType: "scan.request.created",
        payload: {
          requestId: "req-1",
          nurseId: "nurse-1",
          deviceSessionId: "device-1",
          stationId: "A01",
          turnCode: "ABCDE",
          status: "active",
          createdAt: "2026-06-17T00:00:00.000Z"
        }
      }).payload.requestId
    ).toBe("req-1");

    expect(() =>
      stationStatusEventSchema.parse({
        ...envelope,
        eventType: "station.status.updated",
        payload: { stationId: "A01", status: "active", queueDepth: "bad", updatedAt: "2026-06-17T00:00:00.000Z" }
      })
    ).toThrow();
  });

  it("strips unknown station status fields", () => {
    const parsed = stationStatusEventSchema.parse({
      ...envelope,
      eventType: "station.status.updated",
      payload: {
        stationId: "A01",
        status: "active",
        queueDepth: 0,
        updatedAt: "2026-06-17T00:00:00.000Z",
        activeRequestId: "req-1",
        card: { citizenId: "1234567890123" }
      }
    });

    expect(parsed.payload).not.toHaveProperty("activeRequestId");
    expect(parsed.payload).not.toHaveProperty("card");
  });
});
