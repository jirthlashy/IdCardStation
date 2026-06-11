import { ReaderPayload, ReadinessPayload, StationPayload } from "./types";

export function openStationStatusStream(
  backendUrl: string,
  stationId: string,
  handlers: {
    onConnected: () => void;
    onStation: (station: StationPayload) => void;
    onReader: (reader: ReaderPayload) => void;
    onReadiness: (readiness: ReadinessPayload) => void;
    onError: () => void;
  }
) {
  const stream = new EventSource(`${backendUrl}/api/stations/${stationId}/status/events`);
  stream.addEventListener("connected", handlers.onConnected);
  stream.addEventListener("station-status", (event) => {
    const data = JSON.parse((event as MessageEvent).data);
    if (data.kind === "station") handlers.onStation(data.payload);
    if (data.kind === "reader") handlers.onReader(data.payload);
    if (data.kind === "readiness") handlers.onReadiness(data.payload);
  });
  stream.onerror = handlers.onError;
  return stream;
}
