export type ScanState = "idle" | "queued" | "waiting" | "reading" | "received" | "expired" | "failed" | "retryable_error" | "canceling";

export type ScanRequestView = {
  requestId: string;
  requestAccessToken: string;
  deviceSessionId: string;
  stationId: string;
  turnCode: string;
  status: string;
  queuePosition?: number;
  activatedAt?: string;
  expiresAt?: string;
};

export type RequestStatusUpdate = Partial<ScanRequestView> & {
  requestId: string;
  clearRecommended?: boolean;
};

export type ReadinessView = {
  stationId: string;
  readerAlive: boolean;
  readerReady: boolean;
  queueDepth: number;
  canRequestScan: boolean;
  status: string;
  message?: string;
};

export type ThaiIdCardView = {
  citizenId?: string;
  fullNameTh?: string;
  fullNameEn?: string;
  dateOfBirth?: string;
  address?: string;
  photoAsBase64Uri?: string;
};

export type PrivateScanResultView = {
  requestId: string;
  stationId: string;
  deviceSessionId: string;
  deliveredAt: string;
  card: ThaiIdCardView;
};

export const initialReadiness = (stationId: string): ReadinessView => ({
  stationId,
  readerAlive: false,
  readerReady: false,
  queueDepth: 0,
  canRequestScan: false,
  status: "neutral",
  message: "Connecting to station"
});
