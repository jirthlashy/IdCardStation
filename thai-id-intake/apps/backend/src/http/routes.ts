import { Express } from "express";
import { backendConfig } from "../config/config.js";
import { createScanRequestInputSchema, rejectionReasonSchema } from "../config/validation.js";
import { registerSseRoutes } from "../infra/sse.js";
import { createScanRequest, rejectScanRequest } from "../services/scanService.js";
import { getStationReadiness } from "../station/stationStore.js";

export function registerRoutes(app: Express) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, kafkaBrokers: backendConfig.brokers });
  });

  app.get("/api/stations/:stationId/readiness", (req, res) => {
    res.json(getStationReadiness(req.params.stationId));
  });

  app.post("/api/scan-requests", async (req, res) => {
    const input = createScanRequestInputSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "nurseId and stationId are required" });
      return;
    }

    res.status(201).json(await createScanRequest(input.data));
  });

  app.post("/api/scan-requests/:requestId/rejections", async (req, res) => {
    const reason = rejectionReasonSchema.safeParse(req.body?.reason ?? "wrong_patient");
    if (!reason.success) {
      res.status(400).json({ error: "invalid rejection reason" });
      return;
    }

    const result = await rejectScanRequest(req.params.requestId, reason.data);
    if (!result) {
      res.status(404).json({ error: "request not found" });
      return;
    }

    res.json(result);
  });

  registerSseRoutes(app);
}
