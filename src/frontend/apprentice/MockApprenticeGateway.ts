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
} from "./SemanticPipeline";

/**
 * Offline gateway for tests and fixture runs. It performs no semantic
 * classification: statements stay "unknown" and questions use plain fallback
 * wording. It never fabricates expert knowledge.
 */
export class MockApprenticeGateway implements ApprenticeGateway {
  readonly mode = "mock" as const;

  async extractTeachingStatements(request: ExtractionRequest): Promise<TeachingStatement[]> {
    return extractStatements(request.units, null);
  }

  async generateCaptureReviewQuestions(request: CaptureReviewRequest): Promise<QuestionCandidate[]> {
    return buildCaptureReview(request.analysis, RuntimeConfigManager.get(), request.maxQuestions, null, request.skillName);
  }

  async generateDebriefQuestions(request: DebriefRequest): Promise<QuestionCandidate[]> {
    return buildDebrief(request.answered, request.analysis, RuntimeConfigManager.get(), null, request.maxQuestions);
  }

  async generateTeachBack(request: TeachBackRequest): Promise<string> {
    return buildTeachBack(request.items, null);
  }

  async prepareLearning(request: LearnPreparationRequest): Promise<LearnPreparation> {
    const prepared = await buildLearnPreparation(request.lesson, null);
    DebugBus.emit({ category: "AI", event: "MOCK_LEARN_PREPARED", data: { question: prepared.predictionQuestion } });
    return prepared;
  }

  async sendContextualUpdate(payload: unknown): Promise<void> {
    DebugBus.emit({ category: "AI", event: "MOCK_CONTEXTUAL_UPDATE", data: payload });
  }
}
