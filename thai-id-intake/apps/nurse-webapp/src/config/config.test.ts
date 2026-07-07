import { describe, expect, it, vi } from "vitest";

describe("nurse config backend URL resolver", () => {
  it("rejects loopback backend URLs for non-local browsers", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");
    const productionLocation = { hostname: "10.0.0.20", protocol: "https:" } as Location;

    expect(() => resolveBackendUrl("http://127.0.0.1:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
    expect(() => resolveBackendUrl("http://[::1]:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
    expect(() => resolveBackendUrl("http://0.0.0.0:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
  });

  it("accepts configured LAN backend URLs", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");
    const productionLocation = { hostname: "10.0.0.20", protocol: "https:" } as Location;

    expect(resolveBackendUrl("https://10.0.0.10:3001", productionLocation)).toBe("https://10.0.0.10:3001");
  });
});
