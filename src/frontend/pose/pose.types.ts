import type { SessionTimeMs } from "../clock/clock.types";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseFrame {
  articulated3d?: import("../../shared/movement/ArticulatedBody").ArticulatedBody;
  body3d?: import("../../shared/movement/HeavyBody").HeavyBody;
  streamId?: string;
  alignment?: { runId: string; timestampMs: number; result: MovementAlignmentReply };
  bodySkeleton?: import("../../shared/movement/types").BodySkeleton;
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
  timestampMs?: SessionTimeMs;
  articulated3d?: import("../../shared/movement/ArticulatedBody").ArticulatedBody;
  body3d?: import("../../shared/movement/HeavyBody").HeavyBody;
  bodySkeleton?: import("../../shared/movement/types").BodySkeleton;
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
  kind?: MovementKind;
  id: string;
  startMs: SessionTimeMs;
  apexMs?: SessionTimeMs;
  endMs: SessionTimeMs;
  classification: DemonstrationClassification;
  teacherConfirmed: boolean;
  trajectory: NormalizedPose[];
}

export interface CanonicalCheckpoint {
  index: number;
  progress: 0 | 25 | 50 | 75 | 100;
  phase: MovementPhase;
  pose: NormalizedPoseGeometry;
}

export interface CanonicalMovement {
  schemaVersion?: 2 | 3;
  representation?: "rtmw3d-body-v1" | "mediapipe-heavy-body3d-v1" | "mediapipe-articulated-3d-v1";
  articulatedTolerance?: number;
  statisticalCalibration?: import("../../shared/movement/OAS").TeacherCalibration3D;
  references?: MovementReference[];
  kind?: MovementKind;
  samples?: CanonicalSample[];
  anchors?: MovementAnchor[];
  trajectorySource?: "dense_samples" | "demonstration_trajectories" | "legacy_checkpoints" | "coherent_3d_references";
  checkpoints: CanonicalCheckpoint[];
}

export interface MovementReference {
  articulatedEvidence?: {sourceIndices:number[];arcLength:number;excursion:number;rejectionReasons:string[]};
  trajectoryEvidence?: {
    construction: "observed-trajectory-v1";
    representation: "mediapipe-heavy-body3d-v1";
    sourceIndices: number[];
    arcLength: number;
    excursion: number;
    noise: number;
    maximumGapMs: number;
    terminalStartDistance: number;
    kind: MovementKind;
    maximumNeighborError: number;
    startSourceIndex: number;
    terminalSourceIndex: number;
    rejectionReasons: string[];
  };
  anchorConstruction?: "observed-regions-v1";
  quality?: ReferenceQuality;
  teacherConfirmed: boolean;
  alignmentEligible: boolean;
  rejectionReason?: string;
  demonstrationId: string;
  samples: CanonicalSample[];
  anchors: MovementAnchor[];
  sourceTrajectory: NormalizedPose[];
}

export type MovementKind = "cycle" | "sequence";
export type MovementPhase = "outbound" | "apex" | "return" | "sequence";

export interface CanonicalSample {
  progress01: number;
  phase: MovementPhase;
  pose: NormalizedPoseGeometry;
}

export interface MovementAlignmentReply {
  event: "REP_SUCCESS" | "SEQUENCE_COMPLETE" | null;
  referenceId: string;
  similarity: number;
  alignmentMethod?: "local_trajectory";
  localDistance?: number | null;
  normalizedDtwDistance: number | null;
  currentProgressPercent: number;
  furthestProgressPercent: number;
  currentPhase: string;
  lastSatisfiedAnchor: string | null;
  runtimeTargetCount: number;
  runtimeTargetIndex: number;
  reason: string;
  alignedSample: CanonicalSample;
  usable: boolean;
  alignmentMs: number;
}

export interface MovementAnchor extends CanonicalSample {
  id: "start" | "apex" | "completion";
  holdMs: number;
  holdSource?: "teacher_requested";
  region?: ObservedAnchorRegion;
}

export interface ObservedAnchorRegion {
  startSourceIndex: number;
  endSourceIndex: number;
  startMs: number;
  endMs: number;
  samples: NormalizedPose[];
  diameter: number;
  maximumSpeed: number;
}

export interface ReferenceQuality {
  regions: { start?: ObservedAnchorRegion; turnaround?: ObservedAnchorRegion; completion?: ObservedAnchorRegion };
  sourceSamples: number;
  reliableSamples: number;
  nominalIntervalMs: number;
  largestConfidenceGapMs: number;
  excursion: number;
  regionRadius: number;
  stableSpeed: number;
  gaps: Array<{ beforeSourceIndex: number; afterSourceIndex: number; durationMs: number; missingSamples: number; distance: number | null; coherent: boolean; reason: string }>;
  rejectionReasons: string[];
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
