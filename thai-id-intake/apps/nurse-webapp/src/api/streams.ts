import { PrivateScanResultView, ReadinessView, RequestStatusUpdate } from "../state/types";

export function openRequestStatusStream(
  backendUrl: string,
  requestId: string,
  accessToken: string,
  handlers: {
    onConnected: () => void;
    onStatus: (update: RequestStatusUpdate) => void;
    onError: () => void;
  }
) {
  const stream = new EventSource(`${backendUrl}/api/scan-requests/${requestId}/events?accessToken=${encodeURIComponent(accessToken)}`);
  stream.addEventListener("connected", handlers.onConnected);
  stream.addEventListener("request-status", (event) => {
    handlers.onStatus(JSON.parse((event as MessageEvent).data));
  });
  stream.onerror = handlers.onError;
  return stream;
}

export function openStationReadinessStream(
  backendUrl: string,
  stationId: string,
  handlers: {
    onConnected: () => void;
    onReadiness: (readiness: ReadinessView) => void;
    onError: () => void;
  }
) {
  const stream = new EventSource(`${backendUrl}/api/stations/${stationId}/status/events`);
  stream.addEventListener("connected", handlers.onConnected);
  stream.addEventListener("station-status", (event) => {
    const update = JSON.parse((event as MessageEvent).data);
    if (update.kind === "readiness") handlers.onReadiness(update.payload);
  });
  stream.onerror = handlers.onError;
  return stream;
}

export function openPrivateResultStream(
  backendUrl: string,
  requestId: string,
  accessToken: string,
  handlers: {
    onConnected: () => void;
    onResult: (result: PrivateScanResultView) => void;
    onError: () => void;
  }
) {
  const stream = new EventSource(`${backendUrl}/api/scan-requests/${requestId}/result-events?accessToken=${encodeURIComponent(accessToken)}`);
  stream.addEventListener("connected", handlers.onConnected);
  stream.addEventListener("scan-result", (event) => {
    handlers.onResult(JSON.parse((event as MessageEvent).data));
  });
  stream.onerror = handlers.onError;
  return stream;
}
