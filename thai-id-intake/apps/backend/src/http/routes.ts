import { Express } from "express";
import { backendConfig, isAllowedStationId } from "../config/config.js";
import { createScanRequestInputSchema, scanRejectionInputSchema } from "../config/validation.js";
import { registerSseRoutes } from "../infra/sse.js";
import { createScanRequest, rejectScanRequest, ScanRequestRejectedError } from "../services/scanService.js";
import { getStationReadiness } from "../station/stationStore.js";

const scanRequestRateLimits = new Map<string, { count: number; resetAt: number }>();

export function registerRoutes(app: Express) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kafkaBrokers: backendConfig.brokers });
  });

  app.get("/api/stations/:stationId/readiness", (req, res) => {
    if (!isAllowedStationId(req.params.stationId)) {
      res.status(404).json({ error: "station not found" });
      return;
    }
    res.json(getStationReadiness(req.params.stationId));
  });

  app.post("/api/scan-requests", async (req, res) => {
    const input = createScanRequestInputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "nurseId and stationId are required" });
      return;
    }

    const rateLimit = consumeScanRequestRateLimit(`${req.ip}:${input.data.stationId}`);
    if (!rateLimit.allowed) {
      res.status(429).json({ error: "too many scan requests", retryAfterMs: rateLimit.retryAfterMs });
      return;
    }

    try {
      res.status(201).json(await createScanRequest(input.data));
    } catch (error) {
      if (error instanceof ScanRequestRejectedError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/scan-requests/:requestId/rejections", async (req, res) => {
    const input = scanRejectionInputSchema.safeParse(req.body ?? {});
    if (!input.success) {
      res.status(400).json({ error: "invalid rejection request" });
      return;
    }

    try {
      const result = await rejectScanRequest(req.params.requestId, input.data.reason, input.data.accessToken);
      if (!result) {
        res.status(404).json({ error: "request not found" });
        return;
      }

      res.json(result);
    } catch (error) {
      if (error instanceof ScanRequestRejectedError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  registerSseRoutes(app);
}

function consumeScanRequestRateLimit(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const existing = scanRequestRateLimits.get(key);
  if (!existing || existing.resetAt <= now) {
    scanRequestRateLimits.set(key, { count: 1, resetAt: now + backendConfig.scanRequestRateLimitWindowMs });
    return { allowed: true };
  }
  if (existing.count >= backendConfig.scanRequestRateLimitMax) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { allowed: true };
}
