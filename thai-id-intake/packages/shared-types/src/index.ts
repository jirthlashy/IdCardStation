export const KAFKA_TOPICS = {
  scanRequests: "scan.requests",
  readerCardRead: "reader.card-read",
  scanRejections: "scan.rejections",
  auditScanEvents: "audit.scan-events",
  stationStatus: (stationId: string) => `station.status.${assertKafkaTopicSuffix(stationId)}`,
  readerStatus: (stationId: string) => `reader.status.${assertKafkaTopicSuffix(stationId)}`,
  privateScanResult: (deviceSessionId: string) => `scan-result.${assertKafkaTopicSuffix(deviceSessionId)}`
} as const;

export const SAFE_TOPIC_SUFFIX_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function isSafeTopicSuffix(value: string): boolean {
  return SAFE_TOPIC_SUFFIX_PATTERN.test(value);
}

export function assertKafkaTopicSuffix(value: string): string {
  if (!isSafeTopicSuffix(value)) {
    throw new Error("Unsafe Kafka topic suffix");
  }
  return value;
}

export type ScanRequestStatus =
  | "created"
  | "queued"
  | "active"
  | "reading"
  | "retryable_error"
  | "fulfilled"
  | "canceled"
  | "rejected"
  | "misrouted"
  | "expired"
  | "failed";

export type StationLifecycleStatus =
  | "neutral"
  | "queued"
  | "active"
  | "reading"
  | "delivered"
  | "cooldown"
  | "canceled"
  | "expired"
  | "failed"
  | "misrouted";

export type ReaderState =
  | "starting"
  | "ready"
  | "waiting_for_request"
  | "waiting_for_card"
  | "card_inserted"
  | "card_removed"
  | "reading"
  | "read_failed_retryable"
  | "heartbeat"
  | "error";

export const READY_READER_STATES = ["ready", "waiting_for_request", "waiting_for_card", "heartbeat", "card_removed"] as const satisfies readonly ReaderState[];

export function isReaderReadyState(state: ReaderState): boolean {
  return READY_READER_STATES.includes(state as (typeof READY_READER_STATES)[number]);
}

export type EventType =
  | "scan.request.created"
  | "station.status.updated"
  | "reader.status.updated"
  | "reader.card_read.completed"
  | "scan.result.private"
  | "scan.rejected"
  | "audit.scan_event";

export interface KafkaEnvelope<TPayload, TEventType extends EventType = EventType> {
  eventId: string;
  eventType: TEventType;
  version: 1;
  occurredAt: string;
  correlationId: string;
  requestId?: string;
  stationId?: string;
  deviceSessionId?: string;
  payload: TPayload;
}

export interface ThaiIdCardPayload {
  citizenId: string;
  titleTh?: string;
  titleEn?: string;
  fullNameTh?: string;
  fullNameEn?: string;
  firstNameTh?: string;
  firstNameEn?: string;
  lastNameTh?: string;
  lastNameEn?: string;
  dateOfBirth?: string;
  gender?: string;
  cardIssuer?: string;
  issueDate?: string;
  expireDate?: string;
  address?: string;
  photoAsBase64Uri?: string;
}

export interface ScanRequest {
  requestId: string;
  nurseId: string;
  deviceSessionId: string;
  stationId: string;
  turnCode: string;
  status: ScanRequestStatus;
  createdAt: string;
  activatedAt?: string;
  expiresAt?: string;
}

export interface CreateScanRequestInput {
  nurseId: string;
  deviceSessionId?: string;
  stationId: string;
}

export interface CreateScanRequestResponse {
  requestId: string;
  requestAccessToken: string;
  deviceSessionId: string;
  stationId: string;
  turnCode: string;
  activatedAt?: string;
  expiresAt?: string;
  status: ScanRequestStatus;
  queuePosition: number;
}

export interface SafeStationStatus {
  stationId: string;
  turnCode?: string;
  status: StationLifecycleStatus;
  readerState?: ReaderState;
  expiresAt?: string;
  cooldownUntil?: string;
  queueDepth: number;
  message?: string;
  updatedAt: string;
}

export interface ReaderStatus {
  stationId: string;
  readerId: string;
  state: ReaderState;
  readerReady?: boolean;
  activeRequestId?: string;
  turnCode?: string;
  message?: string;
  updatedAt: string;
}

export interface StationReadiness {
  stationId: string;
  readerAlive: boolean;
  readerReady: boolean;
  lastReaderSeenAt?: string;
  activeTurnCode?: string;
  activeExpiresAt?: string;
  cooldownUntil?: string;
  queueDepth: number;
  canRequestScan: boolean;
  status: StationLifecycleStatus;
  message?: string;
  updatedAt: string;
}

export interface ReaderCardRead {
  requestId: string;
  stationId: string;
  readerId: string;
  source: "PCSC_THAI_ID" | "OCR_FALLBACK";
  readAt: string;
  card: ThaiIdCardPayload;
}

export interface PrivateScanResult {
  requestId: string;
  stationId: string;
  deviceSessionId: string;
  deliveredAt: string;
  card: ThaiIdCardPayload;
}

export interface ScanRejection {
  requestId: string;
  stationId: string;
  deviceSessionId: string;
  reason: "wrong_patient" | "not_mine" | "cancel" | "other";
  rejectedAt: string;
}

export interface AuditEvent {
  action:
    | "request_created"
    | "code_activated"
    | "card_scan_received"
    | "result_delivered"
    | "scan_rejected"
    | "scan_canceled"
    | "scan_expired"
    | "duplicate_card_read"
    | "read_error"
    | "misrouted";
  requestId?: string;
  stationId?: string;
  deviceSessionId?: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export type ScanRequestCreatedEvent = KafkaEnvelope<ScanRequest, "scan.request.created">;
export type StationStatusEvent = KafkaEnvelope<SafeStationStatus, "station.status.updated">;
export type ReaderStatusEvent = KafkaEnvelope<ReaderStatus, "reader.status.updated">;
export type ReaderCardReadEvent = KafkaEnvelope<ReaderCardRead, "reader.card_read.completed">;
export type PrivateScanResultEvent = KafkaEnvelope<PrivateScanResult, "scan.result.private">;
export type ScanRejectedEvent = KafkaEnvelope<ScanRejection, "scan.rejected">;
export type AuditScanEvent = KafkaEnvelope<AuditEvent, "audit.scan_event">;
