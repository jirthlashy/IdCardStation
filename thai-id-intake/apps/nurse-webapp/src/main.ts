import "./style.css";

type ScanState = "idle" | "waiting" | "reading" | "received" | "expired" | "failed";

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001";
const app = document.querySelector<HTMLDivElement>("#root");
let state: ScanState = "idle";
let currentRequest: any;
let result: any;
let resultStream: EventSource | undefined;

function render() {
  if (!app) return;
  app.innerHTML = `
    <main class="shell">
      <section class="toolbar">
        <div>
          <h1>Thai ID Intake</h1>
          <p>Station A01 secure scan request</p>
        </div>
        <button id="scan">Scan ID Card</button>
      </section>
      <section class="status">
        <div class="label">Status</div>
        <div class="value">${state}</div>
        <div class="code">${currentRequest?.turnCode ?? "-----"}</div>
        <p>${statusText()}</p>
      </section>
      ${result ? resultHtml() : ""}
      ${currentRequest ? `<button id="reject" class="secondary">Wrong Patient / Not Mine</button>` : ""}
    </main>
  `;
  document.querySelector("#scan")?.addEventListener("click", createRequest);
  document.querySelector("#reject")?.addEventListener("click", rejectRequest);
}

function statusText() {
  if (state === "idle") return "Tap once to create a private scan request.";
  if (state === "waiting") return "Compare this code with the station PC, then insert the card.";
  if (state === "received") return "Private result received for this iPad session.";
  if (state === "expired") return "Request expired. Tap scan again if still needed.";
  if (state === "failed") return "Scan failed. Retry or use the fallback workflow.";
  return "Reader is working.";
}

function resultHtml() {
  const card = result.card;
  return `
    <section class="result">
      <h2>Patient Autofill</h2>
      <dl>
        <dt>Citizen ID</dt><dd>${card.citizenId ?? ""}</dd>
        <dt>Thai name</dt><dd>${card.fullNameTh ?? ""}</dd>
        <dt>English name</dt><dd>${card.fullNameEn ?? ""}</dd>
        <dt>Date of birth</dt><dd>${card.dateOfBirth ?? ""}</dd>
        <dt>Address</dt><dd>${card.address ?? ""}</dd>
      </dl>
    </section>
  `;
}

async function createRequest() {
  state = "waiting";
  result = undefined;
  render();
  const response = await fetch(`${backendUrl}/api/scan-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nurseId: "demo-nurse", stationId: "A01", deviceSessionId: localStorage.getItem("deviceSessionId") ?? undefined })
  });
  currentRequest = await response.json();
  localStorage.setItem("deviceSessionId", currentRequest.deviceSessionId);
  subscribeToPrivateResult(currentRequest.deviceSessionId);
  render();
}

function subscribeToPrivateResult(deviceSessionId: string) {
  resultStream?.close();
  resultStream = new EventSource(`${backendUrl}/api/scan-results/${deviceSessionId}/events`);
  resultStream.addEventListener("scan-result", (event) => {
    result = JSON.parse((event as MessageEvent).data);
    state = "received";
    render();
  });
  resultStream.onerror = () => {
    if (state !== "received") state = "failed";
    render();
  };
}

async function rejectRequest() {
  if (!currentRequest) return;
  await fetch(`${backendUrl}/api/scan-requests/${currentRequest.requestId}/rejections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "wrong_patient" })
  });
  state = "idle";
  currentRequest = undefined;
  result = undefined;
  resultStream?.close();
  resultStream = undefined;
  render();
}

render();
