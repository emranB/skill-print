import { Router } from "express";
import { loadEnv } from "../config/env.js";
import { hasElevenLabsCredentials } from "../services/ElevenLabsServer.js";

export const healthRouter = Router();

/** Reports whether the apprentice model can be used, never the credentials themselves. */
healthRouter.get("/health", (_req, res) => {
  const configured = hasElevenLabsCredentials();
  const forced = loadEnv().apprenticeDefault;
  res.json({
    ok: true,
    service: "skillprint",
    apprentice: {
      configured,
      defaultMode: forced ?? (configured ? "elevenlabs" : "mock"),
    },
  });
});
