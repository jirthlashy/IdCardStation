import { isReaderReadyState, KAFKA_TOPICS, ReaderStatus } from "@thai-id-intake/shared-types";
import { readerConfig, readerId } from "../config/config.js";
import { envelope, nowIso } from "../events/events.js";
import { publishJson } from "../infra/kafkaClient.js";
import { getActiveRequest } from "../state/state.js";

type ReaderHardwareStatus = {
  state: "waiting_for_reader" | "available" | "unavailable";
  message?: string;
};

let readerHardwareStatus: ReaderHardwareStatus = {
  state: "waiting_for_reader",
  message: "Waiting for PC/SC reader"
};

export function resetReaderHardwareStatus() {
  readerHardwareStatus = {
    state: "waiting_for_reader",
    message: "Waiting for PC/SC reader"
  };
}

export function markReaderHardwareAvailable(message?: string) {
  readerHardwareStatus = {
    state: "available",
    message
  };
}

export function markReaderHardwareUnavailable(message: string) {
  readerHardwareStatus = {
    state: "unavailable",
    message
  };
}

export function getReaderHeartbeatStatus(): { state: ReaderStatus["state"]; message: string } {
  const activeRequest = getActiveRequest();
  if (readerHardwareStatus.state === "waiting_for_reader") {
    return {
      state: "starting",
      message: readerHardwareStatus.message ?? "Waiting for PC/SC reader"
    };
  }
  if (readerHardwareStatus.state === "unavailable") {
    return {
      state: "error",
      message: readerHardwareStatus.message ?? "Reader hardware is not ready"
    };
  }
  return activeRequest
    ? { state: "heartbeat", message: "Reader heartbeat with active request" }
    : { state: "waiting_for_request", message: readerHardwareStatus.message ?? "Reader heartbeat" };
}

export async function publishReaderHeartbeat() {
  const heartbeat = getReaderHeartbeatStatus();
  await publishReaderStatus(heartbeat.state, heartbeat.message);
}

export async function publishReaderStatus(state: ReaderStatus["state"], message?: string) {
  const activeRequest = getActiveRequest();
  const payload: ReaderStatus = {
    stationId: readerConfig.stationId,
    readerId,
    state,
    readerReady: readerHardwareStatus.state === "available" && isReaderReadyState(state),
    activeRequestId: activeRequest?.requestId,
    turnCode: activeRequest?.turnCode,
    message,
    updatedAt: nowIso()
  };
  await publishJson(
    KAFKA_TOPICS.readerStatus(readerConfig.stationId),
    envelope({ eventType: "reader.status.updated", payload, stationId: readerConfig.stationId, requestId: activeRequest?.requestId }),
    readerConfig.stationId
  );
  console.log(`[reader-agent] ${state}${activeRequest?.turnCode ? ` code=${activeRequest.turnCode}` : ""}${message ? ` ${message}` : ""}`);
}
