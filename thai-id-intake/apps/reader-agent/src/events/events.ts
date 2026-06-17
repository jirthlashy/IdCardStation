import { nanoid } from "nanoid";
import { EventType } from "@thai-id-intake/shared-types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function envelope<TPayload>(args: {
  eventType: EventType;
  payload: TPayload;
  requestId?: string;
  stationId?: string;
  deviceSessionId?: string;
  correlationId?: string;
}) {
  return {
    eventId: nanoid(),
    version: 1 as const,
    occurredAt: nowIso(),
    correlationId: args.correlationId ?? nanoid(),
    eventType: args.eventType,
    requestId: args.requestId,
    stationId: args.stationId,
    deviceSessionId: args.deviceSessionId,
    payload: args.payload
  };
}
