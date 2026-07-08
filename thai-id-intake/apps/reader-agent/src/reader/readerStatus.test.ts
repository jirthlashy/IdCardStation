import { beforeEach, describe, expect, it } from "vitest";
import {
  getReaderHeartbeatStatus,
  markReaderHardwareAvailable,
  markReaderHardwareUnavailable,
  resetReaderHardwareStatus
} from "./readerStatus.js";
import { clearActiveRequest, setActiveRequest } from "../state/state.js";

describe("reader heartbeat status", () => {
  beforeEach(() => {
    clearActiveRequest();
    resetReaderHardwareStatus();
  });

  it("reports starting until a PC/SC reader is detected", () => {
    expect(getReaderHeartbeatStatus()).toEqual({
      state: "starting",
      message: "Waiting for PC/SC reader"
    });
  });

  it("keeps heartbeat in error when hardware startup fails", () => {
    markReaderHardwareUnavailable("PC/SC error: service unavailable");

    expect(getReaderHeartbeatStatus()).toEqual({
      state: "error",
      message: "PC/SC error: service unavailable"
    });
  });

  it("reports ready heartbeat only after hardware is available", () => {
    markReaderHardwareAvailable("PC/SC reader detected: A01");

    expect(getReaderHeartbeatStatus()).toEqual({
      state: "waiting_for_request",
      message: "PC/SC reader detected: A01"
    });
  });

  it("includes active request heartbeat only when hardware is available", () => {
    setActiveRequest({
      requestId: "req-1",
      nurseId: "nurse-1",
      deviceSessionId: "device-1",
      stationId: "A01",
      turnCode: "ABCDE",
      status: "active",
      createdAt: new Date().toISOString()
    });
    markReaderHardwareAvailable("PC/SC reader detected: A01");

    expect(getReaderHeartbeatStatus()).toEqual({
      state: "heartbeat",
      message: "Reader heartbeat with active request"
    });
  });
});
