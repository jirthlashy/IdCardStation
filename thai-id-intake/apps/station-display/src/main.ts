import "./style.css";
import { appConfig } from "./config";
import { openStationStatusStream } from "./stream";
import { initialReader, initialReadiness, initialStation, ReaderPayload, ReadinessPayload, StationPayload } from "./types";
import { render } from "./view";

const app = document.querySelector<HTMLDivElement>("#root");

let station: StationPayload = initialStation(appConfig.stationId);
let reader: ReaderPayload = initialReader(appConfig.stationId);
let readiness: ReadinessPayload = initialReadiness(appConfig.stationId);
let connected = false;

function rerender() {
  render({
    app,
    connected,
    reader,
    readiness,
    station,
    stationId: appConfig.stationId
  });
}

function connect() {
  openStationStatusStream(appConfig.backendUrl, appConfig.stationId, {
    onConnected: () => {
      connected = true;
      rerender();
    },
    onStation: (update) => {
      station = update;
      connected = true;
      rerender();
    },
    onReader: (update) => {
      reader = update;
      connected = true;
      rerender();
    },
    onReadiness: (update) => {
      readiness = update;
      connected = true;
      rerender();
    },
    onError: () => {
      connected = false;
      rerender();
    }
  });
}

rerender();
connect();
window.setInterval(rerender, 1000);
