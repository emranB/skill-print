import { Router } from "express";
import { loadEnv } from "../config/env.js";
import { getSignedConversationUrl } from "../services/ApprenticeTextSession.js";

export const elevenLabsRouter = Router();

/** Session bootstrap. Returns a short-lived signed URL; the API key never leaves the server. */
elevenLabsRouter.post("/elevenlabs/session", async (_req, res) => {
  const env = loadEnv();
  if (!env.elevenLabsApiKey || !env.elevenLabsAgentId) {
    res.status(503).json({
      error: "ELEVENLABS_NOT_CONFIGURED",
      message: "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID",
    });
    return;
  }
  try {
    const signedUrl = await getSignedConversationUrl();
    res.json({ agentId: env.elevenLabsAgentId, signedUrl, configured: true });
  } catch (error) {
    res.status(502).json({
      error: "ELEVENLABS_SESSION_FAILED",
      message: error instanceof Error ? error.message : "Session bootstrap failed",
    });
  }
});
