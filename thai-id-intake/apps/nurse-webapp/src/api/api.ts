import { ScanRequestView } from "../state/types";

export async function checkHealth(backendUrl: string) {
  const response = await fetch(`${backendUrl}/health`, { cache: "no-store" });
  return response.ok;
}

export async function createScanRequest(backendUrl: string, stationId: string, nurseId: string): Promise<ScanRequestView> {
  const response = await fetch(`${backendUrl}/api/scan-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nurseId, stationId })
  });
  if (!response.ok) throw new Error("scan request failed");
  return response.json();
}

export async function rejectScanRequest(backendUrl: string, requestId: string, accessToken: string, reason: "cancel" | "wrong_patient") {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${backendUrl}/api/scan-requests/${requestId}/rejections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, accessToken }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error("scan rejection failed");
  } finally {
    window.clearTimeout(timeout);
  }
}
