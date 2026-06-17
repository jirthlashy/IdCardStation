import "./style.css";
import { checkHealth, createScanRequest, rejectScanRequest } from "./api";
import { appConfig } from "./config";
import { openPrivateResultStream, openRequestStatusStream, openStationReadinessStream } from "./streams";
import { startExpiryTicker, startResultClearTimer } from "./timers";
import { initialReadiness, PrivateScanResultView, ReadinessView, ScanRequestView, ScanState } from "./types";
import { render } from "./view";

const app = document.querySelector<HTMLDivElement>("#root");
let state: ScanState = "idle";
let currentRequest: ScanRequestView | undefined;
let result: PrivateScanResultView | undefined;
let resultStream: EventSource | undefined;
let requestStream: EventSource | undefined;
let stationStream: EventSource | undefined;
let tickTimer: number | undefined;
let clearTimer: number | undefined;
let connected = false;
let justActivated = false;
let readiness: ReadinessView = initialReadiness(appConfig.stationId);

function rerender() {
  render(
    {
      app,
      connected,
      currentRequest,
      justActivated,
      readiness,
      result,
      state,
      stationId: appConfig.stationId
    },
    {
      onCancel: () => {
        void cancelRequest();
      },
      onCreateRequest: () => {
        void requestScan();
      },
      onWrongPatient: () => {
        void wrongPatientRequest();
      }
    }
  );
}

async function requestScan() {
  state = "waiting";
  result = undefined;
  rerender();
  try {
    currentRequest = await createScanRequest(appConfig.backendUrl, appConfig.stationId);
    connected = true;
    state = currentRequest.status === "queued" ? "queued" : "waiting";
    subscribeToPrivateResult(currentRequest.deviceSessionId);
    subscribeToRequestStatus(currentRequest.requestId);
    startTicker();
    rerender();
  } catch {
    connected = false;
    state = "failed";
    rerender();
  }
}

function subscribeToRequestStatus(requestId: string) {
  requestStream?.close();
  requestStream = openRequestStatusStream(appConfig.backendUrl, requestId, {
    onConnected: () => {
      connected = true;
      rerender();
    },
    onStatus: (update) => {
      connected = true;
      if (!currentRequest || update.requestId !== currentRequest.requestId) return;
      if (update.clearRecommended) {
        clearPrivateResult();
        return;
      }
      currentRequest = { ...currentRequest, ...update };
      if (update.status === "active") {
        state = "waiting";
        justActivated = true;
        window.setTimeout(() => {
          justActivated = false;
          rerender();
        }, 5000);
        navigator.vibrate?.(200);
      }
      if (update.status === "reading") state = "reading";
      if (update.status === "retryable_error") state = "retryable_error";
      if (update.status === "expired") state = "expired";
      if (update.status === "canceled" || update.status === "misrouted") {
        resetRequestState();
      }
      rerender();
    },
    onError: () => {
      connected = false;
      rerender();
    }
  });
}

function subscribeToStationReadiness() {
  stationStream?.close();
  stationStream = openStationReadinessStream(appConfig.backendUrl, appConfig.stationId, {
    onConnected: () => {
      connected = true;
      rerender();
    },
    onReadiness: (update) => {
      connected = true;
      readiness = update;
      rerender();
    },
    onError: () => {
      connected = false;
      readiness = { ...readiness, readerAlive: false, readerReady: false, canRequestScan: false, message: "Station connection unavailable" };
      rerender();
    }
  });
}

function startTicker() {
  tickTimer = startExpiryTicker({
    currentTimer: tickTimer,
    getCurrentRequest: () => currentRequest,
    getResult: () => result,
    onExpired: () => {
      state = "expired";
      resultStream?.close();
      resultStream = undefined;
    },
    onTick: rerender
  });
}

function subscribeToPrivateResult(deviceSessionId: string) {
  resultStream?.close();
  resultStream = openPrivateResultStream(appConfig.backendUrl, deviceSessionId, {
    onConnected: () => {
      connected = true;
      rerender();
    },
    onResult: (privateResult) => {
      connected = true;
      result = privateResult;
      state = "received";
      clearTimer = startResultClearTimer(clearTimer, appConfig.resultAutoClearSeconds, clearPrivateResult);
      rerender();
    },
    onError: () => {
      connected = false;
      if (state !== "received") state = "failed";
      rerender();
    }
  });
}

function resetRequestState() {
  result = undefined;
  currentRequest = undefined;
  state = "idle";
  resultStream?.close();
  resultStream = undefined;
  requestStream?.close();
  requestStream = undefined;
  if (tickTimer) window.clearInterval(tickTimer);
  tickTimer = undefined;
  if (clearTimer) window.clearTimeout(clearTimer);
  clearTimer = undefined;
}

function clearPrivateResult() {
  resetRequestState();
  rerender();
}

async function checkSystemConnection() {
  try {
    connected = await checkHealth(appConfig.backendUrl);
  } catch {
    connected = false;
  }
  rerender();
}

async function cancelRequest() {
  if (!currentRequest) return;
  state = "canceling";
  rerender();
  try {
    await rejectScanRequest(appConfig.backendUrl, currentRequest.requestId, "cancel");
    resetRequestState();
  } catch {
    connected = false;
    state = "failed";
  }
  rerender();
}

async function wrongPatientRequest() {
  if (!currentRequest) return;
  try {
    await rejectScanRequest(appConfig.backendUrl, currentRequest.requestId, "wrong_patient");
    resetRequestState();
  } catch {
    connected = false;
    state = "failed";
  }
  rerender();
}

subscribeToStationReadiness();
void checkSystemConnection();
