import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderCardReadEvent } from "@thai-id-intake/shared-types";
import { handleCardRead } from "./cardReadHandler.js";
import { requests, stations } from "../station/stationStore.js";

function makeEvent(): ReaderCardReadEvent {
  return {
    eventId: "evt-1",
    eventType: "reader.card_read.completed",
    version: 1,
    occurredAt: "2026-06-17T00:00:00.000Z",
    correlationId: "corr-1",
    requestId: "req-1",
    stationId: "A01",
    deviceSessionId: "device-1",
    payload: {
      requestId: "req-1",
      stationId: "A01",
      readerId: "A01-PC-01",
      source: "PCSC_THAI_ID",
      readAt: "2026-06-17T00:00:00.000Z",
      card: { citizenId: "1234567890123" }
    }
  };
}

describe("handleCardRead", () => {
  beforeEach(() => {
    requests.clear();
    stations.clear();
  });

  it("does not mark a request fulfilled when private result publish fails", async () => {
    requests.set("req-1", {
      requestId: "req-1",
      nurseId: "nurse-1",
      deviceSessionId: "bad/topic",
      stationId: "A01",
      turnCode: "ABCDE",
      status: "active",
      createdAt: "2026-06-17T00:00:00.000Z",
      activatedAt: "2026-06-17T00:00:00.000Z",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    stations.set("A01", { stationId: "A01", activeRequestId: "req-1", queue: [] });
    const deps = {
      audit: vi.fn(async () => undefined),
      emitPrivateResult: vi.fn(),
      emitRequestClearRecommended: vi.fn(),
      emitRequestStatus: vi.fn(),
      publishJson: vi.fn(async () => {
        throw new Error("Kafka rejected topic");
      }),
      publishStationStatus: vi.fn(async () => undefined),
      startCooldown: vi.fn(async () => undefined)
    };

    await handleCardRead(makeEvent(), deps);

    expect(requests.get("req-1")?.status).toBe("failed");
    expect(deps.emitPrivateResult).not.toHaveBeenCalled();
    expect(deps.publishStationStatus).toHaveBeenCalledWith("A01", "failed", "Private result delivery failed; rescan required", expect.objectContaining({ requestId: "req-1" }));
    expect(deps.startCooldown).toHaveBeenCalledWith("A01");
  });
});
