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

export const appConfig = {
  backendUrl: resolveBackendUrl(import.meta.env.VITE_BACKEND_URL, window.location),
  stationId: import.meta.env.VITE_STATION_ID ?? "A01",
  nurseId: import.meta.env.VITE_NURSE_ID ?? "unassigned-nurse",
  resultAutoClearSeconds: Number(import.meta.env.VITE_RESULT_AUTO_CLEAR_SECONDS ?? 120)
};
