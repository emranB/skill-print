import { Router } from "express";
import { z } from "zod";
import { hasElevenLabsCredentials } from "../services/ElevenLabsServer.js";
import {
  ExtractInputSchema,
  LearnPrepInputSchema,
  PhraseInputSchema,
  TeachBackInputSchema,
  extractStatements,
  phraseQuestions,
  prepareLearning,
  summarizeTeachBack,
} from "../services/ApprenticeStructured.js";
import { ApprenticeUnavailableError } from "../services/ApprenticeTextSession.js";

export const apprenticeRouter = Router();

const RequestSchema = z.discriminatedUnion("task", [
  z.object({ task: z.literal("extract_statements"), input: ExtractInputSchema }),
  z.object({ task: z.literal("phrase_questions"), input: PhraseInputSchema }),
  z.object({ task: z.literal("teach_back"), input: TeachBackInputSchema }),
  z.object({ task: z.literal("learn_prep"), input: LearnPrepInputSchema }),
]);

type StructuredRequest = z.infer<typeof RequestSchema>;

function runTask(body: StructuredRequest): Promise<unknown> {
  switch (body.task) {
    case "extract_statements":
      return extractStatements(body.input);
    case "phrase_questions":
      return phraseQuestions(body.input);
    case "teach_back":
      return summarizeTeachBack(body.input);
    case "learn_prep":
      return prepareLearning(body.input);
  }
}

/** Structured semantic tasks for the apprentice. Output is untrusted; the client validates it. */
apprenticeRouter.post("/apprentice/structured", async (req, res) => {
  if (!hasElevenLabsCredentials()) {
    res.status(503).json({ error: "ELEVENLABS_NOT_CONFIGURED", message: "Apprentice model not configured" });
    return;
  }
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid" });
    return;
  }
  const started = Date.now();
  try {
    const output = await runTask(parsed.data);
    res.json({ task: parsed.data.task, output, elapsedMs: Date.now() - started });
  } catch (error) {
    const unavailable = error instanceof ApprenticeUnavailableError;
    res.status(unavailable ? 503 : 502).json({
      error: unavailable ? "APPRENTICE_UNAVAILABLE" : "APPRENTICE_BAD_OUTPUT",
      message: error instanceof Error ? error.message : "Apprentice task failed",
    });
  }
});
