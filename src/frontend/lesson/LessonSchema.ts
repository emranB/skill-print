import { z } from "zod";
import { TEACHING_STATEMENT_KINDS } from "../analyze/analyze.types";

export const LandmarkSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  visibility: z.number().optional(),
});

export const NormalizedPoseGeometrySchema = z.object({
  landmarks: z.array(LandmarkSchema),
});

export const NormalizedPoseSchema = NormalizedPoseGeometrySchema.extend({
  timestampMs: z.number(),
});

export const KnowledgeProvenanceSchema = z.object({
  sourceClass: z.enum(["EXPLICIT_TEACHING", "EXPERT_ANSWER", "OBSERVED", "CONFIRMED_TEACH_BACK"]),
  statementId: z.string().optional(),
  questionId: z.string().optional(),
  questionText: z.string().optional(),
  expertAnswer: z.string().optional(),
  demonstrationId: z.string().optional(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  transcriptText: z.string().optional(),
  transcriptStartMs: z.number().optional(),
  transcriptEndMs: z.number().optional(),
  alignment: z.enum(["ALIGNED", "PARTIAL", "UNALIGNED"]).optional(),
  geometry: z.array(z.object({ feature: z.string(), description: z.string() })).optional(),
  confidence: z.number().optional(),
  correctedFrom: z.string().optional(),
  simulated: z.boolean().optional(),
});

const TeachingStatementKindSchema = z.enum(TEACHING_STATEMENT_KINDS);

export const TeachingStatementSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  kind: TeachingStatementKindSchema,
  statement: z.string().min(1),
  sourceText: z.string().min(1),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  confidence: z.number().min(0).max(1),
  refersToDemonstration: z.boolean(),
  sourceClass: z.enum(["EXPLICIT_TEACHING", "EXPERT_ANSWER"]),
  extractor: z.enum(["apprentice_model", "unclassified_fallback"]),
  questionId: z.string().optional(),
  questionText: z.string().optional(),
});

/** Raw apprentice model output for statement extraction (compact keys keep replies short). */
export const ExtractionResponseSchema = z.object({
  s: z.array(
    z.object({
      i: z.number().int().nonnegative(),
      k: TeachingStatementKindSchema,
      t: z.string().min(1).max(240),
      c: z.number().min(0).max(1),
      d: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
    }),
  ),
});

/** Raw apprentice model output for question phrasing. */
export const QuestionPhrasingResponseSchema = z.object({
  q: z.array(
    z.object({
      g: z.number().int().nonnegative(),
      t: z.string().min(8).max(300),
    }),
  ),
});

export const TeachBackResponseSchema = z.object({
  summary: z.string().min(10).max(1200),
});

/** Raw apprentice model output for learn preparation: prediction question and per-phase cues. */
export const LearnPreparationResponseSchema = z.object({
  p: z.string().min(8).max(300),
  c: z
    .array(z.object({ ph: z.enum(["outbound", "apex", "return"]), t: z.string().min(3).max(160) }))
    .max(6)
    .default([]),
});

export const BaseQuestionCandidateSchema = z.object({
  id: z.string(),
  type: z.enum(["reason", "importance", "variation", "guardrail", "classification"]),
  question: z.string(),
  evidence: z.array(
    z.object({
      feature: z.string(),
      description: z.string(),
      startMs: z.number().optional(),
      endMs: z.number().optional(),
      data: z.unknown().optional(),
    }),
  ),
  rationale: z.string(),
  uncertainty: z.string().optional(),
  confidence: z.number(),
  answer: z.string().optional(),
  status: z.enum(["pending", "answered", "skipped"]),
  gapType: z
    .enum(["why", "judgment", "boundary", "exception", "attention", "failure", "uncertainty"])
    .optional(),
  statementId: z.string().optional(),
  simulatedAnswer: z.boolean().optional(),
  askedLive: z.boolean().optional(),
});

export const CaptureReviewQuestionSchema = BaseQuestionCandidateSchema.extend({
  phase: z.literal("capture_review"),
  timestampMs: z.number(),
  clipStartMs: z.number(),
  clipEndMs: z.number(),
});

export const DebriefQuestionSchema = BaseQuestionCandidateSchema.extend({
  phase: z.literal("debrief"),
  timestampMs: z.number().optional(),
  clipStartMs: z.number().optional(),
  clipEndMs: z.number().optional(),
});

export const QuestionCandidateSchema = z.discriminatedUnion("phase", [
  CaptureReviewQuestionSchema,
  DebriefQuestionSchema,
]);

export const TeachingMediaSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    source: z.enum(["live", "upload", "fixture"]),
    durationMs: z.number(),
    video: z.any().optional(),
    poseRecording: z
      .object({
        schemaVersion: z.literal(1),
        id: z.string(),
        sessionId: z.string(),
        frames: z.array(
          z.object({
            timestampMs: z.number(),
            landmarks: z.array(LandmarkSchema),
            worldLandmarks: z.array(LandmarkSchema),
          }),
        ),
      })
      .optional(),
    sourceName: z.string().optional(),
  })
  .refine((m) => Boolean(m.video || m.poseRecording), {
    message: "TeachingMedia requires video and/or poseRecording",
  });

export const LessonSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  importantThings: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  teacherCalibration: z.any(),
  referencePose: NormalizedPoseSchema,
  demonstrations: z.array(z.any()),
  canonicalMovement: z.object({
    checkpoints: z.array(
      z.object({
        index: z.number(),
        progress: z.union([
          z.literal(0),
          z.literal(25),
          z.literal(50),
          z.literal(75),
          z.literal(100),
        ]),
        phase: z.enum(["outbound", "apex", "return"]),
        pose: NormalizedPoseGeometrySchema,
      }),
    ),
  }),
  knowledge: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      statement: z.string(),
      reason: z.string().optional(),
      importance: z.number(),
      teacherConfirmed: z.boolean(),
      provenance: KnowledgeProvenanceSchema,
    }),
  ),
  guardrails: z.array(
    z.object({
      id: z.string(),
      statement: z.string(),
      reason: z.string().optional(),
      teacherConfirmed: z.boolean(),
      provenance: KnowledgeProvenanceSchema,
    }),
  ),
  trackingProfile: z.object({
    requiredLandmarks: z.array(z.number()),
    requiredFeatures: z.array(z.string()),
  }),
  sourceSessionId: z.string(),
});
