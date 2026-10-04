import { Router } from "express";
import multer from "multer";
import { hasElevenLabsCredentials, transcribeWithScribe } from "../services/ElevenLabsServer.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

export const transcribeRouter = Router();

transcribeRouter.post("/transcribe", upload.single("file"), async (req, res) => {
  const started = Date.now();
  try {
    if (!hasElevenLabsCredentials()) {
      res.status(503).json({
        error: "ELEVENLABS_NOT_CONFIGURED",
        message: "Missing ELEVENLABS_API_KEY",
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "MISSING_FILE" });
      return;
    }

    const result = await transcribeWithScribe(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
    );

    res.json({
      schemaVersion: 1,
      words: result.words,
      fullText: result.fullText,
      audioDurationSecs: result.audioDurationSecs,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    res.status(502).json({
      error: "TRANSCRIBE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      elapsedMs: Date.now() - started,
    });
  }
});
