export type StationPayload = {
  stationId: string;
  turnCode?: string;
  status?: string;
  readerState?: string;
  expiresAt?: string;
  cooldownUntil?: string;
  queueDepth?: number;
  message?: string;
  updatedAt?: string;
};

export type ReaderPayload = {
  stationId: string;
  readerId: string;
  state: string;
  readerReady?: boolean;
  turnCode?: string;
  message?: string;
  updatedAt?: string;
};

export type ReadinessPayload = {
  stationId: string;
  readerAlive: boolean;
  readerReady: boolean;
  lastReaderSeenAt?: string;
  activeTurnCode?: string;
  activeExpiresAt?: string;
  cooldownUntil?: string;
  queueDepth: number;
  canRequestScan: boolean;
  status: string;
  message?: string;
  updatedAt?: string;
};

export function initialStation(stationId: string): StationPayload {
  return {
    stationId,
    status: "idle",
    message: "Waiting for scan request"
  };
}

export function initialReader(stationId: string): ReaderPayload {
  return {
    stationId,
    readerId: `${stationId}-PC-01`,
    state: "starting",
    message: "Connecting to reader agent"
  };
}

export function initialReadiness(stationId: string): ReadinessPayload {
  return {
    stationId,
    readerAlive: false,
    readerReady: false,
    queueDepth: 0,
    canRequestScan: false,
    status: "neutral",
    message: "Waiting for reader heartbeat"
  };
}
