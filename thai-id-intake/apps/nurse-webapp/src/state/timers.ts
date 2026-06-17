import { PrivateScanResultView, ScanRequestView } from "./types";

export function startExpiryTicker(args: {
  currentTimer?: number;
  getCurrentRequest: () => ScanRequestView | undefined;
  getResult: () => PrivateScanResultView | undefined;
  onExpired: () => void;
  onTick: () => void;
}) {
  if (args.currentTimer) window.clearInterval(args.currentTimer);
  return window.setInterval(() => {
    const currentRequest = args.getCurrentRequest();
    if (!currentRequest || args.getResult()) return;
    if (!currentRequest.expiresAt) {
      args.onTick();
      return;
    }
    if (Date.parse(currentRequest.expiresAt) <= Date.now()) {
      args.onExpired();
    }
    args.onTick();
  }, 1000);
}

export function startResultClearTimer(currentTimer: number | undefined, clearAfterSeconds: number, onClear: () => void) {
  if (currentTimer) window.clearTimeout(currentTimer);
  return window.setTimeout(onClear, clearAfterSeconds * 1000);
}
