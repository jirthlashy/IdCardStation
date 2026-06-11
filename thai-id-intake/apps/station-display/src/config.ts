function resolveBackendUrl() {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL;
  const isBrowserLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (configuredUrl && (isBrowserLocalhost || !configuredUrl.includes("localhost"))) return configuredUrl;
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export const appConfig = {
  backendUrl: resolveBackendUrl(),
  stationId: import.meta.env.VITE_STATION_ID ?? "A01"
};
