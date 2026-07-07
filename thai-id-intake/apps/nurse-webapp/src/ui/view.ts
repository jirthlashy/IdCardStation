import { PrivateScanResultView, ReadinessView, ScanRequestView, ScanState } from "../state/types";
import { escapeHtml } from "./escapeHtml";

type ViewState = {
  app: HTMLDivElement | null;
  connected: boolean;
  currentRequest?: ScanRequestView;
  justActivated: boolean;
  readiness: ReadinessView;
  result?: PrivateScanResultView;
  state: ScanState;
  stationId: string;
};

type ViewHandlers = {
  onCancel: () => void;
  onCreateRequest: () => void;
  onWrongPatient: () => void;
};

export function render(view: ViewState, handlers: ViewHandlers) {
  if (!view.app) return;
  view.app.innerHTML = `
    <main class="shell">
      <section class="toolbar">
        <div>
          <h1>Thai ID Intake</h1>
          <p>Station ${escapeHtml(view.stationId)} secure scan request</p>
        </div>
        <div class="actions">
          <div class="connection ${view.connected ? "online" : "offline"}">${view.connected ? "Connected" : "Offline"}</div>
          <button id="scan" ${!view.readiness.canRequestScan || view.currentRequest ? "disabled" : ""}>Scan ID Card</button>
        </div>
      </section>
      <section class="readiness ${view.readiness.readerReady ? "ready" : "offline"}">
        <div class="label">Station</div>
        <div class="value">${escapeHtml(view.stationId)} ${view.readiness.readerReady ? "Ready" : "Reader offline"}</div>
        <p>${escapeHtml(readinessText(view.connected, view.readiness))}</p>
      </section>
      ${view.result ? resultHtml(view.result) : ""}
      <section class="status">
        <div class="label">Status</div>
        <div class="value">${escapeHtml(view.justActivated ? "Your turn now" : view.state)}</div>
        <div class="code ${view.state === "expired" ? "expired-code" : ""}">${escapeHtml(view.currentRequest?.turnCode ?? "-----")}</div>
        <p>${escapeHtml(statusText(view.state, view.currentRequest))}</p>
      </section>
      ${view.currentRequest && !view.result ? `<button id="cancel" class="secondary" ${view.state === "canceling" ? "disabled" : ""}>${view.state === "canceling" ? "Canceling" : "Cancel"}</button>` : ""}
      ${view.currentRequest && view.result ? `<button id="wrong-patient" class="secondary">Wrong Patient / Not Mine</button>` : ""}
    </main>
  `;
  document.querySelector("#scan")?.addEventListener("click", handlers.onCreateRequest);
  document.querySelector("#cancel")?.addEventListener("click", handlers.onCancel);
  document.querySelector("#wrong-patient")?.addEventListener("click", handlers.onWrongPatient);
}

function statusText(state: ScanState, currentRequest?: ScanRequestView) {
  if (state === "idle") return "Tap once to create a private scan request.";
  if (state === "queued") return `Queued for station. Position ${currentRequest?.queuePosition ?? "-"}. Timer starts when this code appears at the station.`;
  if (state === "waiting") return `Compare this code with the station PC, then insert the card. ${expiryText(currentRequest)}`;
  if (state === "retryable_error") return `Read failed, reinsert card. Same code is still active. ${expiryText(currentRequest)}`;
  if (state === "received") return "Private result received for this iPad session.";
  if (state === "expired") return "Request expired. Tap scan again if still needed.";
  if (state === "failed") return "Scan failed. Retry or use the fallback workflow.";
  if (state === "canceling") return "Canceling this scan request.";
  return "Reader is working.";
}

function readinessText(connected: boolean, readiness: ReadinessView) {
  if (!connected) return "System connection unavailable.";
  if (!readiness.readerReady) return "Reader is offline or not ready. Scan requests are paused.";
  if (readiness.status === "cooldown") return `Station cooling down. Queue: ${readiness.queueDepth ?? 0}.`;
  if (readiness.status === "active" || readiness.status === "reading") return `Station busy. Queue: ${readiness.queueDepth ?? 0}.`;
  return `Queue: ${readiness.queueDepth ?? 0}.`;
}

function expiryText(currentRequest?: ScanRequestView) {
  if (!currentRequest?.expiresAt) return "";
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(currentRequest.expiresAt) - Date.now()) / 1000));
  return remainingSeconds > 0 ? `Expires in ${remainingSeconds}s.` : "Expired.";
}

function resultHtml(result: PrivateScanResultView) {
  const card = result.card;
  const photo = isSafePhotoDataUri(card.photoAsBase64Uri)
    ? `<img class="id-photo" src="${escapeHtml(card.photoAsBase64Uri)}" alt="Thai ID card portrait" />`
    : `<div class="id-photo placeholder">No photo</div>`;

  return `
    <section class="result">
      <h2>Patient Autofill</h2>
      <div class="patient-result">
        ${photo}
        <dl>
          <dt>Citizen ID</dt><dd>${escapeHtml(card.citizenId)}</dd>
          <dt>Thai name</dt><dd>${escapeHtml(card.fullNameTh)}</dd>
          <dt>English name</dt><dd>${escapeHtml(card.fullNameEn)}</dd>
          <dt>Date of birth</dt><dd>${escapeHtml(card.dateOfBirth)}</dd>
          <dt>Address</dt><dd>${escapeHtml(card.address)}</dd>
        </dl>
      </div>
    </section>
  `;
}

export function isSafePhotoDataUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}
