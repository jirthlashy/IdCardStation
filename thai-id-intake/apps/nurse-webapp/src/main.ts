import "./style.css";

type ScanState = "idle" | "queued" | "waiting" | "reading" | "received" | "expired" | "failed";

const backendUrl = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001";
const app = document.querySelector<HTMLDivElement>("#root");
let state: ScanState = "idle";
let currentRequest: any;
let result: any;
let resultStream: EventSource | undefined;
let tickTimer: number | undefined;
let connected = false;

function render() {
  if (!app) return;
  app.innerHTML = `
    <main class="shell">
      <section class="toolbar">
        <div>
          <h1>Thai ID Intake</h1>
          <p>Station A01 secure scan request</p>
        </div>
        <div class="actions">
          <div class="connection ${connected ? "online" : "offline"}">${connected ? "Connected" : "Offline"}</div>
          <button id="scan">Scan ID Card</button>
        </div>
      </section>
      ${result ? resultHtml() : ""}
      <section class="status">
        <div class="label">Status</div>
        <div class="value">${state}</div>
        <div class="code">${currentRequest?.turnCode ?? "-----"}</div>
        <p>${statusText()}</p>
      </section>
      ${currentRequest && !result ? `<button id="cancel" class="secondary">Cancel</button>` : ""}
      ${currentRequest && result ? `<button id="wrong-patient" class="secondary">Wrong Patient / Not Mine</button>` : ""}
    </main>
  `;
  document.querySelector("#scan")?.addEventListener("click", createRequest);
  document.querySelector("#cancel")?.addEventListener("click", cancelRequest);
  document.querySelector("#wrong-patient")?.addEventListener("click", wrongPatientRequest);
}

function statusText() {
  if (state === "idle") return "Tap once to create a private scan request.";
  if (state === "queued") return `Queued for station. Position ${currentRequest?.queuePosition ?? "-"}. Timer starts when this code appears at the station.`;
  if (state === "waiting") return `Compare this code with the station PC, then insert the card. ${expiryText()}`;
  if (state === "received") return "Private result received for this iPad session.";
  if (state === "expired") return "Request expired. Tap scan again if still needed.";
  if (state === "failed") return "Scan failed. Retry or use the fallback workflow.";
  return "Reader is working.";
}

function expiryText() {
  if (!currentRequest?.expiresAt) return "";
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(currentRequest.expiresAt) - Date.now()) / 1000));
  return remainingSeconds > 0 ? `Expires in ${remainingSeconds}s.` : "Expired.";
}

function resultHtml() {
  const card = result.card;
  const photo = card.photoAsBase64Uri
    ? `<img class="id-photo" src="${card.photoAsBase64Uri}" alt="Thai ID card portrait" />`
    : `<div class="id-photo placeholder">No photo</div>`;

  return `
    <section class="result">
      <h2>Patient Autofill</h2>
      <div class="patient-result">
        ${photo}
        <dl>
          <dt>Citizen ID</dt><dd>${card.citizenId ?? ""}</dd>
          <dt>Thai name</dt><dd>${card.fullNameTh ?? ""}</dd>
          <dt>English name</dt><dd>${card.fullNameEn ?? ""}</dd>
          <dt>Date of birth</dt><dd>${card.dateOfBirth ?? ""}</dd>
          <dt>Address</dt><dd>${card.address ?? ""}</dd>
        </dl>
      </div>
    </section>
  `;
}

async function createRequest() {
  state = "waiting";
  result = undefined;
  render();
  try {
    const response = await fetch(`${backendUrl}/api/scan-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nurseId: "demo-nurse", stationId: "A01", deviceSessionId: localStorage.getItem("deviceSessionId") ?? undefined })
    });
    connected = response.ok;
    if (!response.ok) throw new Error("scan request failed");
    currentRequest = await response.json();
    state = currentRequest.status === "queued" ? "queued" : "waiting";
    localStorage.setItem("deviceSessionId", currentRequest.deviceSessionId);
    subscribeToPrivateResult(currentRequest.deviceSessionId);
    startTicker();
    render();
  } catch {
    connected = false;
    state = "failed";
    render();
  }
}

function startTicker() {
  if (tickTimer) window.clearInterval(tickTimer);
  tickTimer = window.setInterval(() => {
    if (!currentRequest || result) return;
    if (!currentRequest.expiresAt) {
      render();
      return;
    }
    if (Date.parse(currentRequest.expiresAt) <= Date.now()) {
      state = "expired";
      resultStream?.close();
      resultStream = undefined;
    }
    render();
  }, 1000);
}

function subscribeToPrivateResult(deviceSessionId: string) {
  resultStream?.close();
  resultStream = new EventSource(`${backendUrl}/api/scan-results/${deviceSessionId}/events`);
  resultStream.addEventListener("connected", () => {
    connected = true;
    render();
  });
  resultStream.addEventListener("scan-result", (event) => {
    connected = true;
    result = JSON.parse((event as MessageEvent).data);
    state = "received";
    render();
  });
  resultStream.onerror = () => {
    connected = false;
    if (state !== "received") state = "failed";
    render();
  };
}

async function checkSystemConnection() {
  try {
    const response = await fetch(`${backendUrl}/health`, { cache: "no-store" });
    connected = response.ok;
  } catch {
    connected = false;
  }
  render();
}

async function cancelRequest() {
  if (!currentRequest) return;
  await fetch(`${backendUrl}/api/scan-requests/${currentRequest.requestId}/rejections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "cancel" })
  });
  state = "idle";
  currentRequest = undefined;
  result = undefined;
  resultStream?.close();
  resultStream = undefined;
  if (tickTimer) window.clearInterval(tickTimer);
  tickTimer = undefined;
  render();
}

async function wrongPatientRequest() {
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
  if (tickTimer) window.clearInterval(tickTimer);
  tickTimer = undefined;
  render();
}

void checkSystemConnection();
