import { isReaderReadyState, KAFKA_TOPICS, ReaderStatus } from "@thai-id-intake/shared-types";
import { readerConfig, readerId } from "./config.js";
import { envelope } from "./events.js";
import { publishJson } from "./kafkaClient.js";
import { getActiveRequest } from "./state.js";
import { nowIso } from "./events.js";

export async function publishReaderStatus(state: ReaderStatus["state"], message?: string) {
  const activeRequest = getActiveRequest();
  const payload: ReaderStatus = {
    stationId: readerConfig.stationId,
    readerId,
    state,
    readerReady: isReaderReadyState(state),
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
