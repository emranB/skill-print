import type {
  AnalysisEvidence,
  QuestionCandidate,
  SessionAnalysis,
  TeachingStatement,
  TeachingUnit,
} from "../analyze/analyze.types";
import type { Lesson } from "../lesson/lesson.types";
import type { TeachBackItem } from "../lesson/TeachBackItems";
import type { CanonicalCheckpoint } from "../pose/pose.types";

export interface ExtractionRequest {
  units: TeachingUnit[];
}

export interface CaptureReviewRequest {
  analysis: SessionAnalysis;
  maxQuestions: number;
  skillName?: string;
}

export interface DebriefRequest {
  answered: QuestionCandidate[];
  analysis: SessionAnalysis;
  maxQuestions?: number;
  skillName?: string;
}

export interface TeachBackRequest {
  items: TeachBackItem[];
  skillName?: string;
}

export interface LearnPreparationRequest {
  lesson: Lesson;
}

export type CheckpointPhase = CanonicalCheckpoint["phase"];

/** Prepared once before practice so live coaching never waits on the model. */
export interface LearnPreparation {
  predictionQuestion: string;
  cues: Partial<Record<CheckpointPhase, string>>;
  preparedBy: "apprentice_model" | "offline_fallback";
}

/**
 * Boundary between deterministic SkillPrint code and the apprentice model.
 * The model owns meaning (statement kinds, question wording, summaries, cue wording).
 * Geometry, alignment, gap detection and state transitions stay in app code.
 */
export interface ApprenticeGateway {
  readonly mode: "mock" | "elevenlabs";
  extractTeachingStatements(request: ExtractionRequest): Promise<TeachingStatement[]>;
  generateCaptureReviewQuestions(request: CaptureReviewRequest): Promise<QuestionCandidate[]>;
  generateDebriefQuestions(request: DebriefRequest): Promise<QuestionCandidate[]>;
  generateTeachBack(request: TeachBackRequest): Promise<string>;
  prepareLearning(request: LearnPreparationRequest): Promise<LearnPreparation>;
  sendContextualUpdate?(payload: unknown): Promise<void>;
}

export type { AnalysisEvidence };
