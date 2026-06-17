import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScanRequest, rejectScanRequest } from "./scanService.js";
import { lastReaderStatusByStation, requests, stations } from "../station/stationStore.js";

function makeDeps() {
  return {
    activateNextRequest: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    emitRequestStatus: vi.fn(),
    id: vi.fn().mockReturnValueOnce("req-1").mockReturnValueOnce("device-1"),
    publishJson: vi.fn(async () => undefined),
    publishStationStatus: vi.fn(async () => undefined),
    turnCode: vi.fn(() => "ABCDE")
  };
}

describe("scanService", () => {
  beforeEach(() => {
    requests.clear();
    stations.clear();
    lastReaderStatusByStation.clear();
  });

  it("queues a scan request when the reader is not ready", async () => {
    const deps = makeDeps();

    const response = await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);

    expect(response).toMatchObject({ requestId: "req-1", deviceSessionId: "device-1", status: "queued", queuePosition: 1 });
    expect(stations.get("A01")?.queue).toHaveLength(1);
    expect(deps.publishJson).not.toHaveBeenCalled();
    expect(deps.publishStationStatus).toHaveBeenCalledWith("A01", "queued", "Reader offline; request queued", undefined);
  });

  it("activates a scan request when the reader is ready", async () => {
    lastReaderStatusByStation.set("A01", {
      stationId: "A01",
      readerId: "A01-PC-01",
      state: "ready",
      readerReady: true,
      updatedAt: new Date().toISOString()
    });
    const deps = makeDeps();

    const response = await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);

    expect(response.status).toBe("active");
    expect(response.activatedAt).toBeDefined();
    expect(response.expiresAt).toBeDefined();
    expect(stations.get("A01")?.activeRequestId).toBe("req-1");
    expect(deps.publishJson).toHaveBeenCalledOnce();
    expect(deps.publishStationStatus).toHaveBeenCalledWith("A01", "active", "Waiting for card", expect.objectContaining({ requestId: "req-1" }));
  });

  it("cancels an active request and clears station state", async () => {
    lastReaderStatusByStation.set("A01", {
      stationId: "A01",
      readerId: "A01-PC-01",
      state: "ready",
      readerReady: true,
      updatedAt: new Date().toISOString()
    });
    const deps = makeDeps();
    await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);

    const result = await rejectScanRequest("req-1", "cancel", deps);

    expect(result).toEqual({ ok: true, status: "canceled" });
    expect(stations.get("A01")?.activeRequestId).toBeUndefined();
    expect(requests.get("req-1")?.status).toBe("canceled");
    expect(deps.activateNextRequest).toHaveBeenCalledWith("A01");
  });
});
