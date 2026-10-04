import { RuntimeConfigManager } from "../config/RuntimeConfig";
import { DebugBus } from "../debug/DebugBus";
import type {
  ApprenticeGateway,
  CaptureReviewRequest,
  DebriefRequest,
  ExtractionRequest,
  LearnPreparation,
  LearnPreparationRequest,
  TeachBackRequest,
} from "./ApprenticeGateway";
import type { QuestionCandidate, TeachingStatement } from "../analyze/analyze.types";
import {
  buildCaptureReview,
  buildDebrief,
  buildLearnPreparation,
  buildTeachBack,
  extractStatements,
  type SemanticModel,
} from "./SemanticPipeline";

type StructuredTask = "extract_statements" | "phrase_questions" | "teach_back" | "learn_prep";

async function callStructured(task: StructuredTask, input: unknown): Promise<unknown> {
  const started = performance.now();
  const response = await fetch("/api/apprentice/structured", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, input }),
  });
  const body = (await response.json().catch(() => ({}))) as { output?: unknown; error?: string; message?: string };
  DebugBus.emit({
    category: "AI",
    level: response.ok ? "info" : "warn",
    event: response.ok ? "APPRENTICE_TASK_COMPLETE" : "APPRENTICE_TASK_FAILED",
    data: { task, status: response.status, elapsedMs: Math.round(performance.now() - started), error: body.error },
  });
  if (!response.ok) throw new Error(body.message ?? `Apprentice task ${task} failed (${response.status})`);
  return body.output;
}

/**
 * Production gateway: semantic work runs on the existing ElevenLabs agent in
 * text-only mode through the server (the API key stays server-side).
 * If the model is unreachable, each step degrades to the offline path and
 * says so in the debug log.
 */
export class ElevenLabsGateway implements ApprenticeGateway {
  readonly mode = "elevenlabs" as const;
  private contextualSender?: (payload: string) => void;

  private readonly model: SemanticModel = {
    extract: (units) => callStructured("extract_statements", { units }),
    phrase: (phase, gaps, context) => callStructured("phrase_questions", { phase, gaps, ...context }),
    summarize: (items, skill) => callStructured("teach_back", { items, skill }),
    prepare: (input) => callStructured("learn_prep", input),
  };

  setContextualSender(sender: ((payload: string) => void) | undefined): void {
    this.contextualSender = sender;
  }

  async extractTeachingStatements(request: ExtractionRequest): Promise<TeachingStatement[]> {
    return extractStatements(request.units, this.model);
  }

  async generateCaptureReviewQuestions(request: CaptureReviewRequest): Promise<QuestionCandidate[]> {
    return buildCaptureReview(
      request.analysis,
      RuntimeConfigManager.get(),
      request.maxQuestions,
      this.model,
      request.skillName,
    );
  }

  async generateDebriefQuestions(request: DebriefRequest): Promise<QuestionCandidate[]> {
    return buildDebrief(
      request.answered,
      request.analysis,
      RuntimeConfigManager.get(),
      this.model,
      request.maxQuestions,
      request.skillName,
    );
  }

  async generateTeachBack(request: TeachBackRequest): Promise<string> {
    return buildTeachBack(request.items, this.model, request.skillName);
  }

  async prepareLearning(request: LearnPreparationRequest): Promise<LearnPreparation> {
    return buildLearnPreparation(request.lesson, this.model);
  }

  async sendContextualUpdate(payload: unknown): Promise<void> {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (this.contextualSender) {
      this.contextualSender(text);
      DebugBus.emit({ category: "AI", event: "CONTEXTUAL_UPDATE_SENT", data: { bytes: text.length } });
      return;
    }
    DebugBus.emit({ category: "AI", level: "debug", event: "CONTEXTUAL_UPDATE_SKIPPED", data: { reason: "no voice session" } });
  }
}
