import { describe, expect, it } from "vitest";
import { currentCode, readerDetail, readerText, scanMessage, timingText } from "./viewModel.js";
import { initialReader, initialReadiness, initialStation } from "../state/types.js";

describe("station display view model", () => {
  it("chooses the safest current code source by priority", () => {
    const readiness = { ...initialReadiness("A01"), activeTurnCode: "READY" };
    const station = { ...initialStation("A01"), turnCode: "STATION" };
    const reader = { ...initialReader("A01"), turnCode: "READER" };

    expect(currentCode(readiness, station, reader)).toBe("READY");
    expect(currentCode({ ...readiness, activeTurnCode: undefined }, station, reader)).toBe("STATION");
    expect(currentCode({ ...readiness, activeTurnCode: undefined }, { ...station, turnCode: undefined }, reader)).toBe("READER");
    expect(currentCode({ ...readiness, activeTurnCode: undefined }, { ...station, turnCode: undefined }, { ...reader, turnCode: undefined })).toBe("-----");
  });

  it("formats reader status and detail", () => {
    expect(readerText({ ...initialReadiness("A01"), readerAlive: false, readerReady: false })).toBe("Reader offline");
    expect(readerText({ ...initialReadiness("A01"), readerAlive: true, readerReady: false })).toBe("Reader not ready");
    expect(readerText({ ...initialReadiness("A01"), readerAlive: true, readerReady: true })).toBe("Reader ready");
    expect(readerDetail(initialReadiness("A01"), { ...initialReader("A01"), message: "Waiting" })).toBe("Waiting");
  });

  it("formats timing and scan messages from lifecycle state", () => {
    const now = Date.now();
    const activeExpiresAt = new Date(now + 10_000).toISOString();
    const cooldownUntil = new Date(now + 5_000).toISOString();

    expect(timingText({ ...initialReadiness("A01"), status: "active", activeExpiresAt }, initialStation("A01"))).toMatch(/^Expires/);
    expect(timingText({ ...initialReadiness("A01"), status: "cooldown", cooldownUntil }, initialStation("A01"))).toMatch(/^Cooldown/);
    expect(timingText({ ...initialReadiness("A01"), status: "queued" }, initialStation("A01"))).toBe("Queued");
    expect(scanMessage({ ...initialReadiness("A01"), readerAlive: false }, initialStation("A01"))).toBe("Reader offline. Scan requests are paused.");
    expect(scanMessage({ ...initialReadiness("A01"), readerAlive: true }, { ...initialStation("A01"), status: "delivered" })).toBe("Remove card");
  });
});
