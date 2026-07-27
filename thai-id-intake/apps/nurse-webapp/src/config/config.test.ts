import { describe, expect, it, vi } from "vitest";

describe("nurse config backend URL resolver", () => {
  it("rejects loopback backend URLs for non-local browsers", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");
    const productionLocation = { hostname: "198.51.100.20", protocol: "https:" } as Location;

    expect(() => resolveBackendUrl("http://127.0.0.1:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
    expect(() => resolveBackendUrl("http://[::1]:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
    expect(() => resolveBackendUrl("http://0.0.0.0:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
  });

  it("accepts configured LAN backend URLs", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");
    const productionLocation = { hostname: "198.51.100.20", protocol: "https:" } as Location;

    expect(resolveBackendUrl("https://198.51.100.10:3001", productionLocation)).toBe("https://198.51.100.10:3001");
  });

  it("uses stationId from the URL before the build-time fallback", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:", search: "" } });
    const { resolveStationId } = await import("./config");

    expect(resolveStationId("A01", { search: "?stationId=F4A01" } as Location)).toBe("F4A01");
    expect(resolveStationId("A01", { search: "" } as Location)).toBe("A01");
    expect(resolveStationId(undefined, { search: "" } as Location)).toBe("A01");
  });

  it("rejects unsafe stationId URL values", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:", search: "" } });
    const { resolveStationId } = await import("./config");

    expect(() => resolveStationId("A01", { search: "?stationId=bad/topic" } as Location)).toThrow("Invalid stationId");
  });
});
