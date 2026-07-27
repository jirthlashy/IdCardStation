export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return Boolean(ipv4 && Number(ipv4[1]) === 127);
}

export function resolveBackendUrl(configuredUrl: string | undefined, browserLocation: Pick<Location, "hostname" | "protocol">) {
  if (configuredUrl) {
    let parsed: URL;
    try {
      parsed = new URL(configuredUrl);
    } catch {
      throw new Error("Invalid VITE_BACKEND_URL");
    }
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserLocation.hostname)) {
      throw new Error("Loopback VITE_BACKEND_URL is not allowed for non-local browsers");
    }
    return parsed.origin;
  }
  return `${browserLocation.protocol}//${browserLocation.hostname}:3001`;
}

const SAFE_STATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function resolveStationId(configuredStationId: string | undefined, browserLocation: Pick<Location, "search">) {
  const search = browserLocation.search ?? "";
  const requestedStationId = new URLSearchParams(search).get("stationId")?.trim();
  const stationId = requestedStationId || configuredStationId?.trim() || "A01";
  if (!SAFE_STATION_ID_PATTERN.test(stationId)) {
    throw new Error("Invalid stationId");
  }
  return stationId;
}

export const appConfig = {
  backendUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_URL, window.location),
  stationId: resolveStationId(import.meta.env.VITE_STATION_ID, window.location),
  nurseId: import.meta.env.VITE_NURSE_ID ?? "unassigned-nurse",
  resultAutoClearSeconds: Number(import.meta.env.VITE_RESULT_AUTO_CLEAR_SECONDS ?? 120)
};
