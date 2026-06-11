import { ScanRequestView } from "./types";

export async function checkHealth(backendUrl: string) {
  const response = await fetch(`${backendUrl}/health`, { cache: "no-store" });
  return response.ok;
}

export async function createScanRequest(backendUrl: string, stationId: string): Promise<ScanRequestView> {
  const response = await fetch(`${backendUrl}/api/scan-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nurseId: "demo-nurse", stationId })
  });
  if (!response.ok) throw new Error("scan request failed");
  return response.json();
}

export async function rejectScanRequest(backendUrl: string, requestId: string, reason: "cancel" | "wrong_patient") {
  await fetch(`${backendUrl}/api/scan-requests/${requestId}/rejections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}
