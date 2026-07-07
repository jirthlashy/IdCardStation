import { describe, expect, it, vi } from "vitest";

describe("station display config backend URL resolver", () => {
  it("rejects loopback backend URLs for non-local browsers", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");
    const productionLocation = { hostname: "station-a01.local", protocol: "https:" } as Location;

    expect(() => resolveBackendUrl("http://127.0.0.1:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
    expect(() => resolveBackendUrl("http://localhost:3001", productionLocation)).toThrow("Loopback VITE_BACKEND_URL");
  });

  it("allows loopback backend URLs for local browser development", async () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", protocol: "http:" } });
    const { resolveBackendUrl } = await import("./config");

    expect(resolveBackendUrl("http://127.0.0.1:3001", window.location)).toBe("http://127.0.0.1:3001");
  });
});
