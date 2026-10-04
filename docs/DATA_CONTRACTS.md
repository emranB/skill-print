# DATA_CONTRACTS.md

Canonical TypeScript shapes for SkillPrint. This file is the **only** authoritative source for field shapes. Implementations may extend but must not create incompatible alternate representations.

If another document disagrees about a structure, `docs/DATA_CONTRACTS.md` wins.

Persisted and API-facing structures must have corresponding Zod schemas in implementation (`LessonSchema`, config schema, analysis schemas, etc.). Documented here as TypeScript; Zod is the runtime validation intent.

`RuntimeConfig` corresponds exactly to root `config.json` (literal defaults live in `docs/PROJECT_PLAN.md` until Gate 1 creates the file).

## Session time

`SessionTimeMs` is milliseconds elapsed from the monotonic start of the active Teach or Learn session.

- Live: `performance.now() - activeSessionStartMonotonic`
- Upload analysis: `video.currentTime * 1000`
- Fixture replay: fixture `timestampMs` via `FakeSessionClock`
- Wall-clock ISO strings are metadata only

## Pose fixture JSON contract

`teacher.pose.json` / `student-*.pose.json`:

```json
{
  "schemaVersion": 1,
  "frames": [
    {
      "timestampMs": 0,
      "landmarks": [],
      "worldLandmarks": []
    }
  ]
}
```

Actual fixtures populate full landmark arrays using the production `PoseFrame` representation. No exercise-aware fixture schema.

## Contracts

```ts
export type SessionTimeMs = number;

export interface VersionedArtifact {
  schemaVersion: 1;
}

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

export interface PoseRecording extends VersionedArtifact {
  id: string;
  sessionId: string;
  frames: PoseFrame[];
}

export type MediaSourceKind = "live" | "upload" | "fixture";

/**
 * Unified analysis input. Zod refinement must require at least one of:
 * video or poseRecording.
 *
 * - Live: typically video + poseRecording
 * - Upload: typically video only (poses extracted inside analyzeTeachingSession)
 * - Fixture: typically poseRecording only
 *
 * After analysis, callers may persist the returned SessionAnalysis.poseRecording
 * onto media.poseRecording. Do not store a second independent pose recording
 * on TeachingSession.
 */
export interface TeachingMedia extends VersionedArtifact {
  id: string;
  source: MediaSourceKind;
  durationMs: number;
  video?: Blob | File;
  poseRecording?: PoseRecording;
  sourceName?: string;
}

export type CalibrationHealth = "valid" | "degraded" | "lost";

/** Per-metric runtime calibration health (independently recoverable). */
export interface CalibrationMetricState {
  health: CalibrationHealth;
  updatedAtMs: SessionTimeMs;
  message?: string;
}

/**
 * Continuously changing runtime calibration state.
 * BodyCalibration (optional body) is the persistent body geometry snapshot.
 */
export interface CalibrationState {
  camera: CalibrationMetricState;
  microphone: CalibrationMetricState;
  fullBody: CalibrationMetricState;
  bodyScale: CalibrationMetricState;
  landmarks: Record<number, CalibrationMetricState>;
  body?: BodyCalibration;
}

/** Persistent measured body geometry used by lessons/sessions. */
export interface BodyCalibration {
  capturedAtMs: SessionTimeMs;
  neutralPose: NormalizedPose;
  shoulderWidth: number;
  torsoLength: number;
  hipWidth: number;
  bodyHeightEstimate: number;
  visibility: Record<string, number>;
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
  /** Median geometry across good demos; no single historical timestamp. */
  pose: NormalizedPoseGeometry;
}

export interface CanonicalMovement {
  checkpoints: CanonicalCheckpoint[];
}

export type KnowledgeSourceClass = "EXPLICIT_TEACHING" | "EXPERT_ANSWER" | "OBSERVED" | "CONFIRMED_TEACH_BACK";

export interface KnowledgeProvenance {
  sourceClass: KnowledgeSourceClass;
  statementId?: string;
  questionId?: string;
  questionText?: string;
  expertAnswer?: string;
  demonstrationId?: string;
  startMs?: SessionTimeMs; // evidence clip window
  endMs?: SessionTimeMs;
  transcriptText?: string; // verbatim speech only
  transcriptStartMs?: SessionTimeMs;
  transcriptEndMs?: SessionTimeMs;
  alignment?: "ALIGNED" | "PARTIAL" | "UNALIGNED";
  geometry?: Array<{ feature: string; description: string }>;
  confidence?: number;
  correctedFrom?: string; // text before a teach-back correction
  simulated?: boolean; // harness-typed answer, never shown as real
}

export interface KnowledgeItem {
  id: string;
  kind: string; // teaching statement kind, e.g. target, reason, warning
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

export interface Lesson extends VersionedArtifact {
  id: string;
  name: string;
  importantThings?: string;
  createdAt: string;
  updatedAt: string;

  teacherCalibration: BodyCalibration;
  referencePose: NormalizedPose;

  demonstrations: Demonstration[];
  canonicalMovement: CanonicalMovement;

  knowledge: KnowledgeItem[];
  guardrails: Guardrail[];
  trackingProfile: TrackingProfile;

  sourceSessionId: string;
}

export type QuestionType =
  | "reason"
  | "importance"
  | "variation"
  | "guardrail"
  | "classification";

export interface AnalysisEvidence {
  feature: string;
  description: string;
  startMs?: SessionTimeMs;
  endMs?: SessionTimeMs;
  data?: unknown;
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
}

/** Capture Review questions always have a concrete evidence clip. */
export interface CaptureReviewQuestion extends BaseQuestionCandidate {
  phase: "capture_review";
  timestampMs: SessionTimeMs;
  clipStartMs: SessionTimeMs;
  clipEndMs: SessionTimeMs;
}

/** Debrief questions do not require fabricated clip timestamps. */
export interface DebriefQuestion extends BaseQuestionCandidate {
  phase: "debrief";
  timestampMs?: SessionTimeMs;
  clipStartMs?: SessionTimeMs;
  clipEndMs?: SessionTimeMs;
}

export type QuestionCandidate = CaptureReviewQuestion | DebriefQuestion;

/**
 * Persisted complete analysis attempt. May include later AI-generated
 * QuestionCandidate[]. SessionAnalyzer must never produce QuestionCandidate[].
 * Deterministic pre-AI output is SessionAnalysis only.
 */
export interface AnalysisRun extends VersionedArtifact {
  id: string;
  sessionId: string;
  createdAt: string;

  configSnapshot: RuntimeConfigSnapshot;

  demonstrations: Demonstration[];
  observations: AnalysisEvidence[];
  questions: QuestionCandidate[];
}

/** Mirrors root config.json exactly. */
export interface RuntimeConfig {
  schemaVersion: 1;
  pose: {
    leniency: number;
    minimumVisibility: number;
    sampleFps: number;
    checkpointHoldMs: number;
  };
  calibration: {
    lostTrackingMs: number;
  };
  review: {
    clipBeforeMs: number;
    clipAfterMs: number;
    maximumQuestions: number;
  };
  coaching: {
    mismatchPersistenceMs: number;
    minimumPromptIntervalMs: number;
  };
  debug: {
    enabled: boolean;
  };
}

export interface RuntimeConfigSnapshot extends VersionedArtifact {
  capturedAt: string;
  config: RuntimeConfig;
}

export interface TeachingSession extends VersionedArtifact {
  id: string;
  createdAt: string;

  /** Poses live only on media after analysis attaches them. No sibling pose field. */
  media?: TeachingMedia;

  calibration?: BodyCalibration;
  referencePose?: NormalizedPose;

  lessonName?: string;
  importantThings?: string;
}

export type AppState =
  | "HOME"
  | "TEACH_CALIBRATION"
  | "TEACH_SETUP"
  | "TEACH_READY"
  | "TEACH_RECORDING"
  | "TEACH_RECORDING_REVIEW"
  | "TEACH_ANALYZING"
  | "TEACH_QUESTIONS"
  | "TEACH_LESSON_REVIEW"
  | "TEACH_EDITING"
  | "TEACH_COMPLETE"
  | "LEARN_LIBRARY"
  | "LEARN_CALIBRATION"
  | "LEARN_START_POSITION"
  | "LEARN_ACTIVE"
  | "LEARN_SUCCESS"
  | "LEARN_COMPLETE"
  | "ERROR";

export type DebugCategory =
  | "APP"
  | "CONFIG"
  | "MEDIA"
  | "CALIBRATION"
  | "POSE"
  | "SEGMENTATION"
  | "TRANSCRIPT"
  | "ANALYSIS"
  | "AI"
  | "QUESTION"
  | "LESSON"
  | "STUDENT"
  | "COACH"
  | "STORAGE"
  | "NETWORK"
  | "ERROR"
  | "PERFORMANCE";

export interface DebugEvent {
  id: string;
  wallTimeIso: string;
  /** Present only when associated with an active Teach/Learn session. */
  sessionTimeMs?: SessionTimeMs;
  category: DebugCategory;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  message?: string;
  data?: unknown;
}

/** Word-level transcript for timeline alignment (Gate 8+). */
export interface TranscriptWord {
  text: string;
  startMs: SessionTimeMs;
  endMs: SessionTimeMs;
}

export interface Transcript extends VersionedArtifact {
  words: TranscriptWord[];
  fullText?: string;
}

/**
 * Deterministic inputs for SessionAnalyzer.analyzeTeachingSession.
 * Does not carry AI meaning. Pose frames come from TeachingMedia
 * (existing poseRecording or extracted from video).
 */
export interface AnalyzeTeachingSessionContext {
  sessionId: string;
  transcript?: Transcript;
  referencePose?: NormalizedPose;
  configSnapshot: RuntimeConfigSnapshot;
}

/**
 * SessionAnalysis = deterministic pre-AI analysis output from SessionAnalyzer.
 * AnalysisRun = persisted complete analysis attempt and may include later
 * AI-generated QuestionCandidate[].
 * SessionAnalyzer must never generate QuestionCandidate[].
 */
export interface SessionAnalysis {
  sessionId: string;
  /** Pose recording actually used (supplied or extracted from video). */
  poseRecording: PoseRecording;
  demonstrations: Demonstration[];
  observations: AnalysisEvidence[];
  /** Optional alignment helpers (e.g. words paired to pose windows). */
  timelineNotes?: AnalysisEvidence[];
}
```

## Provenance

A `KnowledgeItem` or `Guardrail` must preserve enough provenance for lesson review to answer "Why does SkillPrint believe this?" At minimum where applicable: question ID, demonstration ID, SessionTimeMs range, transcript text, associated evidence. Optional fields may be absent only when that source genuinely does not exist.

`transcriptText` holds only words the expert actually said in the recording. Answers live in `questionText` and `expertAnswer`. Evidence windows, transcript windows and word assignment all use half-open `[startMs, endMs)` intervals (`src/shared/utils/interval.ts`); a word belongs to the window containing its midpoint.

AI structured output (teaching statements, question phrasing, teach-back summary) is validated with Zod before it reaches application state. The model never computes geometry, never judges student success and never changes workflow state.

## Analysis entrypoint

`src/frontend/analyze/SessionAnalyzer.ts` owns:

```ts
analyzeTeachingSession(
  media: TeachingMedia,
  context: AnalyzeTeachingSessionContext
): Promise<SessionAnalysis>
```

This is the sole production analysis entrypoint. Do not create a second `Lesson` or `PoseFrame` model in analyze types.

Generic media handling inside `analyzeTeachingSession`:
1. If `media.poseRecording` exists → use it as `SessionAnalysis.poseRecording`
2. Else if `media.video` exists → extract poses and return them as `SessionAnalysis.poseRecording`
3. Else → invalid TeachingMedia (rejected by Zod refinement / runtime guard)

The caller may then set `session.media.poseRecording = analysis.poseRecording` for persistence. There is no second pose field on `TeachingSession`.

Question Zod: discriminated union on `phase`. Capture review requires clip timestamps. Debrief clip timestamps stay optional. Never invent evidence timestamps to satisfy a debrief question.

## Notes

- A `NormalizedPose` timestamp belongs to the active session timeline.
- `CanonicalCheckpoint.pose` is `NormalizedPoseGeometry` (no timestamp). Temporal provenance belongs on demonstrations, evidence, and knowledge provenance.
- Teacher confirmation remains authoritative for demonstration classification.
- AI-produced structured data (e.g. `QuestionCandidate[]`) is validated with Zod before application and is not part of `SessionAnalysis`.
- `BodyCalibration` is persistent geometry; `CalibrationState` is continuous per-metric runtime health.
