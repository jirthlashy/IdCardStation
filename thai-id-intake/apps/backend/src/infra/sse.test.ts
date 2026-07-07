import { describe, expect, it } from "vitest";
import { requestStatusPayload, sanitizeStationEvent } from "./sse.js";

describe("sse payload safety", () => {
  it("omits deviceSessionId from request status updates", () => {
    const payload = requestStatusPayload({
      requestId: "req-1",
      deviceSessionId: "device-1",
      nurseId: "nurse-1",
      stationId: "A01",
      turnCode: "ABCDE",
      status: "active",
      createdAt: "2026-06-17T00:00:00.000Z"
    });

    expect(payload).not.toHaveProperty("deviceSessionId");
  });

  it("omits activeRequestId from public reader station events", () => {
    const event = sanitizeStationEvent({
      kind: "reader",
      payload: {
        stationId: "A01",
        readerId: "A01-PC-01",
        state: "waiting_for_card",
        activeRequestId: "req-1",
        turnCode: "ABCDE",
        updatedAt: "2026-06-17T00:00:00.000Z"
      }
    } as never);

    expect(event.payload).not.toHaveProperty("activeRequestId");
  });
});
