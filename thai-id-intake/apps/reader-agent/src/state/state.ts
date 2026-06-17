import { ScanRequestCreatedEvent } from "@thai-id-intake/shared-types";

let activeRequest: ScanRequestCreatedEvent["payload"] | undefined;

export function getActiveRequest() {
  return activeRequest;
}

export function setActiveRequest(request: ScanRequestCreatedEvent["payload"]) {
  activeRequest = request;
}

export function clearActiveRequest() {
  activeRequest = undefined;
}
