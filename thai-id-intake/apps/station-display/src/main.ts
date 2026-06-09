import "./style.css";

type StationPayload = {
  stationId: string;
  activeRequestId?: string;
  turnCode?: string;
  status?: string;
  readerState?: string;
  expiresAt?: string;
  cooldownUntil?: string;
  queueDepth?: number;
  message?: string;
  updatedAt?: string;
};

type ReaderPayload = {
  stationId: string;
  readerId: string;
  state: string;
  turnCode?: string;
  message?: string;
  updatedAt?: string;
};

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001";
const stationId = import.meta.env.VITE_STATION_ID ?? "A01";
const app = document.querySelector<HTMLDivElement>("#root");

let station: StationPayload = {
  stationId,
  status: "idle",
  message: "Waiting for scan request"
};
let reader: ReaderPayload = {
  stationId,
  readerId: `${stationId}-PC-01`,
  state: "starting",
  message: "Connecting to reader agent"
};
let connected = false;
let tickTimer: number | undefined;

function secondsUntil(value?: string) {
  if (!value) return "";
  const seconds = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
  return `${seconds}s`;
}

function timingText() {
  if (station.status === "cooldown") return `Cooldown ${secondsUntil(station.cooldownUntil)}`;
  if (station.expiresAt && (station.status === "active" || station.status === "reading")) {
    return `Expires ${secondsUntil(station.expiresAt)}`;
  }
  if (station.status === "queued") return "Queued";
  return "Ready";
}

function render() {
  if (!app) return;
  const code = station.turnCode ?? reader.turnCode ?? "-----";
  app.innerHTML = `
    <main class="station-shell">
      <section class="station-header">
        <div>
          <div class="eyebrow">Station</div>
          <h1>${stationId}</h1>
        </div>
        <div class="connection ${connected ? "online" : "offline"}">${connected ? "Connected" : "Offline"}</div>
      </section>

      <section class="code-panel">
        <div class="panel-label">Current Scan Code</div>
        <div class="turn-code">${code}</div>
        <div class="hint">Match this code with the nurse iPad before inserting the card.</div>
      </section>

      <section class="status-grid">
        <article>
          <div class="panel-label">Scan Status</div>
          <strong>${station.status ?? "idle"}</strong>
          <p>${station.message ?? "No active request"}</p>
        </article>
        <article>
          <div class="panel-label">Timing</div>
          <strong>${timingText()}</strong>
          <p>Queue depth: ${station.queueDepth ?? 0}</p>
        </article>
        <article>
          <div class="panel-label">Reader</div>
          <strong>${reader.state}</strong>
          <p>${reader.message ?? reader.readerId}</p>
        </article>
      </section>

      <footer>Safe display only. No name, citizen ID, address, or photo is shown here.</footer>
    </main>
  `;
}

function connect() {
  const stream = new EventSource(`${backendUrl}/api/stations/${stationId}/status/events`);
  stream.addEventListener("connected", () => {
    connected = true;
    render();
  });
  stream.addEventListener("station-status", (event) => {
    const data = JSON.parse((event as MessageEvent).data);
    if (data.kind === "station") station = data.payload;
    if (data.kind === "reader") reader = data.payload;
    connected = true;
    render();
  });
  stream.onerror = () => {
    connected = false;
    render();
  };
}

render();
connect();
tickTimer = window.setInterval(render, 1000);
