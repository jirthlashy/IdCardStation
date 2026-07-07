import { beforeEach, describe, expect, it, vi } from "vitest";
import { createScanRequest, rejectScanRequest } from "./scanService.js";
import { lastReaderStatusByStation, requestAccessTokenHashes, requests, stations } from "../station/stationStore.js";

function makeDeps() {
  let idCount = 0;
  return {
    activateNextRequest: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
    emitRequestStatus: vi.fn(),
    id: vi.fn(() => {
      idCount += 1;
      if (idCount === 1) return "req-1";
      if (idCount === 2) return "device-1";
      return `id-${idCount}`;
    }),
    publishJson: vi.fn(async () => undefined),
    publishStationStatus: vi.fn(async () => undefined),
    storeRequestAccessToken: vi.fn(),
    token: vi.fn(() => "access-token-1"),
    verifyRequestAccessToken: vi.fn(() => true),
    turnCode: vi.fn(() => "ABCDE")
  };
}

describe("scanService", () => {
  beforeEach(() => {
    requests.clear();
    stations.clear();
    lastReaderStatusByStation.clear();
    requestAccessTokenHashes.clear();
  });

  it("queues a scan request when the reader is not ready", async () => {
    const deps = makeDeps();

    const response = await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);

    expect(response).toMatchObject({ requestId: "req-1", requestAccessToken: "access-token-1", deviceSessionId: "device-1", status: "queued", queuePosition: 1 });
    expect(stations.get("A01")?.queue).toHaveLength(1);
    expect(deps.storeRequestAccessToken).toHaveBeenCalledWith("req-1", "access-token-1");
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

    const result = await rejectScanRequest("req-1", "cancel", "access-token-1", deps);

    expect(result).toEqual({ ok: true, status: "canceled" });
    expect(stations.get("A01")?.activeRequestId).toBeUndefined();
    expect(requests.get("req-1")?.status).toBe("canceled");
    expect(deps.activateNextRequest).toHaveBeenCalledWith("A01");
  });

  it("rejects cancellation with a bad request access token", async () => {
    lastReaderStatusByStation.set("A01", {
      stationId: "A01",
      readerId: "A01-PC-01",
      state: "ready",
      readerReady: true,
      updatedAt: new Date().toISOString()
    });
    const deps = makeDeps();
    deps.verifyRequestAccessToken.mockReturnValue(false);
    await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);

    await expect(rejectScanRequest("req-1", "cancel", "wrong-token", deps)).rejects.toThrow("request access token is invalid");
    expect(stations.get("A01")?.activeRequestId).toBe("req-1");
    expect(requests.get("req-1")?.status).toBe("active");
  });

  it("rejects arbitrary station ids", async () => {
    const deps = makeDeps();

    await expect(createScanRequest({ nurseId: "nurse-1", stationId: "A02" }, deps)).rejects.toThrow("station is not allowed");
  });

  it("rejects queued requests after the station queue limit", async () => {
    const deps = makeDeps();
    for (let index = 0; index < 10; index += 1) {
      await createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps);
    }

    await expect(createScanRequest({ nurseId: "nurse-1", stationId: "A01" }, deps)).rejects.toThrow("station queue is full");
  });
});
