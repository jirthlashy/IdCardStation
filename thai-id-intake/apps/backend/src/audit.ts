import { AuditEvent, KAFKA_TOPICS } from "@thai-id-intake/shared-types";
import { envelope } from "./events.js";
import { publishJson } from "./kafkaClient.js";

export async function audit(event: AuditEvent) {
  await publishJson(
    KAFKA_TOPICS.auditScanEvents,
    envelope({
      eventType: "audit.scan_event",
      payload: event,
      requestId: event.requestId,
      stationId: event.stationId,
      deviceSessionId: event.deviceSessionId
    }),
    event.requestId
  );
}
