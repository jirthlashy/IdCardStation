import { KAFKA_TOPICS, ReaderCardRead, ThaiIdCardPayload } from "@thai-id-intake/shared-types";
import { readerConfig, readerId } from "../config/config.js";
import { envelope, nowIso } from "../events/events.js";
import { publishJson } from "../infra/kafkaClient.js";
import { publishReaderStatus } from "./readerStatus.js";
import { getActiveRequest } from "../state/state.js";

let lastCitizenId = "";
let lastReadAt = 0;

export async function publishCardRead(card: ThaiIdCardPayload) {
  const activeRequest = getActiveRequest();
  if (!activeRequest) {
    await publishReaderStatus("waiting_for_request", "Card read ignored because no active request exists");
    return;
  }
  if (card.citizenId === lastCitizenId && Date.now() - lastReadAt < readerConfig.readTimeoutMs) {
    await publishReaderStatus("ready", "Duplicate card read debounced");
    return;
  }

  await publishReaderStatus("reading", "Card read complete; sending to backend");
  lastCitizenId = card.citizenId;
  lastReadAt = Date.now();
  const payload: ReaderCardRead = {
    requestId: activeRequest.requestId,
    stationId: readerConfig.stationId,
    readerId,
    source: "PCSC_THAI_ID",
    readAt: nowIso(),
    card
  };
  await publishJson(
    KAFKA_TOPICS.readerCardRead,
    envelope({ eventType: "reader.card_read.completed", payload, requestId: activeRequest.requestId, stationId: readerConfig.stationId, deviceSessionId: activeRequest.deviceSessionId }),
    activeRequest.requestId
  );
  await publishReaderStatus("ready", "Card read sent to backend");
}
