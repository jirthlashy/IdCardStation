import { ReaderPayload, ReadinessPayload, StationPayload } from "../state/types";
import { currentCode, readerDetail, readerText, scanMessage, timingText } from "./viewModel";
import { escapeHtml } from "./escapeHtml";

type ViewState = {
  app: HTMLDivElement | null;
  connected: boolean;
  reader: ReaderPayload;
  readiness: ReadinessPayload;
  station: StationPayload;
  stationId: string;
};

export function render(view: ViewState) {
  if (!view.app) return;
  const code = currentCode(view.readiness, view.station, view.reader);
  view.app.innerHTML = `
    <main class="station-shell">
      <section class="station-header">
        <div>
          <div class="eyebrow">Station</div>
          <h1>${escapeHtml(view.stationId)}</h1>
        </div>
        <div class="connection ${view.connected ? "online" : "offline"}">${view.connected ? "Connected" : "Offline"}</div>
      </section>

      <section class="code-panel">
        <div class="panel-label">Current Scan Code</div>
        <div class="turn-code">${escapeHtml(code)}</div>
        <div class="hint">Match this code with the nurse iPad before inserting the card.</div>
      </section>

      <section class="status-grid">
        <article>
          <div class="panel-label">Scan Status</div>
          <strong>${escapeHtml(view.readiness.status ?? view.station.status ?? "idle")}</strong>
          <p>${escapeHtml(scanMessage(view.readiness, view.station))}</p>
        </article>
        <article>
          <div class="panel-label">Timing</div>
          <strong>${escapeHtml(timingText(view.readiness, view.station))}</strong>
          <p>Queue depth: ${escapeHtml(view.readiness.queueDepth ?? view.station.queueDepth ?? 0)}</p>
        </article>
        <article class="${view.readiness.readerAlive && view.readiness.readerReady ? "reader-ready" : "reader-offline"}">
          <div class="panel-label">Reader</div>
          <strong>${escapeHtml(readerText(view.readiness))}</strong>
          <p>${escapeHtml(readerDetail(view.readiness, view.reader))}</p>
        </article>
      </section>

      <footer>Safe display only. No name, citizen ID, address, or photo is shown here.</footer>
    </main>
  `;
}
