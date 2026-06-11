import { secondsSince, secondsUntil } from "./format";
import { ReaderPayload, ReadinessPayload, StationPayload } from "./types";

export function currentCode(readiness: ReadinessPayload, station: StationPayload, reader: ReaderPayload) {
  return readiness.activeTurnCode ?? station.turnCode ?? reader.turnCode ?? "-----";
}

export function timingText(readiness: ReadinessPayload, station: StationPayload) {
  if (readiness.status === "cooldown") return `Cooldown ${secondsUntil(readiness.cooldownUntil ?? station.cooldownUntil)}`;
  const activeExpiresAt = readiness.activeExpiresAt ?? station.expiresAt;
  if (activeExpiresAt && (readiness.status === "active" || readiness.status === "reading")) {
    return `Expires ${secondsUntil(activeExpiresAt)}`;
  }
  if (readiness.status === "queued") return "Queued";
  return "Ready";
}

export function readerText(readiness: ReadinessPayload) {
  if (!readiness.readerAlive) return "Reader offline";
  if (!readiness.readerReady) return "Reader not ready";
  return "Reader ready";
}

export function readerDetail(readiness: ReadinessPayload, reader: ReaderPayload) {
  const lastSeen = readiness.lastReaderSeenAt ? `Last seen ${secondsSince(readiness.lastReaderSeenAt)} ago` : reader.readerId;
  return reader.message ?? lastSeen;
}

export function scanMessage(readiness: ReadinessPayload, station: StationPayload) {
  if (!readiness.readerAlive) return "Reader offline. Scan requests are paused.";
  if (station.status === "delivered") return "Remove card";
  if (station.status === "cooldown") return "Preparing next code";
  if (station.status === "active") return station.message ?? "Scan this code";
  if (station.status === "reading") return station.message ?? "Reading";
  if (station.status === "failed") return station.message ?? "Read failed - reinsert card";
  return station.message ?? readiness.message ?? "Ready";
}
