import type { SessionTimeMs } from "../clock/clock.types";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseFrame {
  timestampMs: SessionTimeMs;
  landmarks: Landmark[];
  worldLandmarks: Landmark[];
}

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface NormalizedPoseGeometry {
  landmarks: NormalizedLandmark[];
}

export interface NormalizedPose extends NormalizedPoseGeometry {
  timestampMs: SessionTimeMs;
}

export interface PoseRecording {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  frames: PoseFrame[];
}

export type DemonstrationClassification =
  | "unknown"
  | "good"
  | "bad"
  | "fragment"
  | "ignore";

export interface Demonstration {
  id: string;
  startMs: SessionTimeMs;
  apexMs: SessionTimeMs;
  endMs: SessionTimeMs;
  classification: DemonstrationClassification;
  teacherConfirmed: boolean;
  trajectory: NormalizedPose[];
}

export interface CanonicalCheckpoint {
  index: number;
  progress: 0 | 25 | 50 | 75 | 100;
  phase: "outbound" | "apex" | "return";
  pose: NormalizedPoseGeometry;
}

export interface CanonicalMovement {
  checkpoints: CanonicalCheckpoint[];
}

export type KnowledgeSourceClass =
  | "EXPLICIT_TEACHING"
  | "EXPERT_ANSWER"
  | "OBSERVED"
  | "CONFIRMED_TEACH_BACK";

export interface KnowledgeProvenance {
  sourceClass: KnowledgeSourceClass;
  statementId?: string;
  questionId?: string;
  questionText?: string;
  /** Verbatim expert answer when the knowledge came from a question. */
  expertAnswer?: string;
  demonstrationId?: string;
  /** Evidence clip window. */
  startMs?: SessionTimeMs;
  endMs?: SessionTimeMs;
  /** Verbatim transcript speech only. Never an answer or placeholder. */
  transcriptText?: string;
  transcriptStartMs?: SessionTimeMs;
  transcriptEndMs?: SessionTimeMs;
  alignment?: "ALIGNED" | "PARTIAL" | "UNALIGNED";
  geometry?: Array<{ feature: string; description: string }>;
  confidence?: number;
  /** Text before the expert corrected it during teach-back. */
  correctedFrom?: string;
  simulated?: boolean;
}

export interface KnowledgeItem {
  id: string;
  kind: string;
  statement: string;
  reason?: string;
  importance: number;
  teacherConfirmed: boolean;
  provenance: KnowledgeProvenance;
}

export interface Guardrail {
  id: string;
  statement: string;
  reason?: string;
  teacherConfirmed: boolean;
  provenance: KnowledgeProvenance;
}

export interface TrackingProfile {
  requiredLandmarks: number[];
  requiredFeatures: string[];
}

export interface BodyCalibration {
  capturedAtMs: SessionTimeMs;
  neutralPose: NormalizedPose;
  shoulderWidth: number;
  torsoLength: number;
  hipWidth: number;
  bodyHeightEstimate: number;
  visibility: Record<string, number>;
}

/** MediaPipe Pose landmark indices used across the app. */
export const POSE_LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;
