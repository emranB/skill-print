import type { RuntimeConfigSnapshot } from "../../shared/config/config.types";
import type { SessionTimeMs } from "../clock/clock.types";
import type {
  Demonstration,
  NormalizedPose,
  PoseRecording,
} from "../pose/pose.types";

export interface AnalysisEvidence {
  feature: string;
  description: string;
  startMs?: SessionTimeMs;
  endMs?: SessionTimeMs;
  data?: unknown;
}

export type QuestionType =
  | "reason"
  | "importance"
  | "variation"
  | "guardrail"
  | "classification";

/** Generic teaching taxonomy. Assigned by the apprentice model, never by keyword rules. */
export const TEACHING_STATEMENT_KINDS = [
  "instruction",
  "technique",
  "target",
  "reason",
  "warning",
  "modification",
  "exception",
  "progression",
  "sequencing",
  "prescription",
  "emphasis",
  "unknown",
] as const;
export type TeachingStatementKind = (typeof TEACHING_STATEMENT_KINDS)[number];

export type { KnowledgeSourceClass } from "../pose/pose.types";

/** Smallest unit sent for semantic extraction: one transcript sentence or one expert answer. */
export interface TeachingUnit {
  id: string;
  text: string;
  startMs?: SessionTimeMs;
  endMs?: SessionTimeMs;
  source: "EXPLICIT_TEACHING" | "EXPERT_ANSWER";
  questionId?: string;
  questionText?: string;
}

export interface TeachingStatement {
  id: string;
  unitId: string;
  kind: TeachingStatementKind;
  /** Concise restatement produced by the apprentice model. */
  statement: string;
  /** Verbatim source text (transcript sentence or expert answer). */
  sourceText: string;
  startMs?: SessionTimeMs;
  endMs?: SessionTimeMs;
  confidence: number;
  /** Model judged the speaker to be pointing at what is being shown. */
  refersToDemonstration: boolean;
  sourceClass: "EXPLICIT_TEACHING" | "EXPERT_ANSWER";
  extractor: "apprentice_model" | "unclassified_fallback";
  questionId?: string;
  questionText?: string;
}

export type GeometryObservationKind = "angle" | "relative_position" | "pair_distance" | "excursion";

export interface GeometryObservation {
  feature: string;
  kind: GeometryObservationKind;
  startMs: SessionTimeMs;
  endMs: SessionTimeMs;
  min: number;
  minAtMs: SessionTimeMs;
  max: number;
  maxAtMs: SessionTimeMs;
  range: number;
  atApex?: number;
  /** Times where a relative position changes sign (e.g. one landmark passes another). */
  crossingsMs?: SessionTimeMs[];
  coverage: number;
  visibility: number;
  reliability: number;
}

export type AlignmentStatus = "ALIGNED" | "PARTIAL" | "UNALIGNED";

export interface StatementEvidence {
  statementId: string;
  clipStartMs: SessionTimeMs;
  clipEndMs: SessionTimeMs;
  demonstrationId?: string;
  geometryObservations: AnalysisEvidence[];
  alignment: AlignmentStatus;
  confidence: number;
}

export type KnowledgeGapType =
  | "why"
  | "judgment"
  | "boundary"
  | "exception"
  | "attention"
  | "failure"
  | "uncertainty";

export interface KnowledgeGap {
  id: string;
  type: KnowledgeGapType;
  statementId?: string;
  demonstrationId?: string;
  timestampMs: SessionTimeMs;
  clipStartMs: SessionTimeMs;
  clipEndMs: SessionTimeMs;
  evidence: AnalysisEvidence[];
  rationale: string;
  priority: number;
}

export interface BaseQuestionCandidate {
  id: string;
  type: QuestionType;
  question: string;
  evidence: AnalysisEvidence[];
  rationale: string;
  uncertainty?: string;
  confidence: number;
  answer?: string;
  status: "pending" | "answered" | "skipped";
  gapType?: KnowledgeGapType;
  statementId?: string;
  /** Answer was produced by an automated harness, not a person. */
  simulatedAnswer?: boolean;
  /** Asked aloud by the apprentice while the expert was recording. */
  askedLive?: boolean;
}

export interface CaptureReviewQuestion extends BaseQuestionCandidate {
  phase: "capture_review";
  timestampMs: SessionTimeMs;
  clipStartMs: SessionTimeMs;
  clipEndMs: SessionTimeMs;
}

export interface DebriefQuestion extends BaseQuestionCandidate {
  phase: "debrief";
  timestampMs?: SessionTimeMs;
  clipStartMs?: SessionTimeMs;
  clipEndMs?: SessionTimeMs;
}

export type QuestionCandidate = CaptureReviewQuestion | DebriefQuestion;

export interface TranscriptWord {
  text: string;
  startMs: SessionTimeMs;
  endMs: SessionTimeMs;
}

export interface Transcript {
  schemaVersion: 1;
  words: TranscriptWord[];
  fullText?: string;
}

export interface AnalyzeTeachingSessionContext {
  sessionId: string;
  transcript?: Transcript;
  referencePose?: NormalizedPose;
  configSnapshot: RuntimeConfigSnapshot;
  /** Fraction (0 to 1) of video pose extraction done; not called when poses were recorded live. */
  onPoseProgress?: (fraction: number) => void;
}

export interface SegmentationSummary {
  usableFrames: number;
  skippedLowVisibility: number;
  restSource: "supplied" | "stable_dwell" | "fallback_first_frames";
  restDwellMs: number;
  regimes: Array<{ startMs: SessionTimeMs; endMs: SessionTimeMs; enterThreshold: number; exitThreshold: number }>;
  completeCycles: number;
  fragmentCycles: number;
}

export interface SessionAnalysis {
  sessionId: string;
  poseRecording: PoseRecording;
  demonstrations: Demonstration[];
  observations: AnalysisEvidence[];
  timelineNotes?: AnalysisEvidence[];
  segmentation?: SegmentationSummary;
  transcript?: Transcript;
  statements?: TeachingStatement[];
  statementEvidence?: StatementEvidence[];
}

export interface AnalysisRun {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  configSnapshot: RuntimeConfigSnapshot;
  demonstrations: Demonstration[];
  observations: AnalysisEvidence[];
  questions: QuestionCandidate[];
}
