import { z } from "zod";
import { TEACHING_STATEMENT_KINDS } from "../analyze/analyze.types";
import { observedRegionSchema, referenceQualitySchema } from "../../shared/movement/referenceSchema";
import { heavyBodySchema, teacherCalibrationSchema, trajectoryEvidenceSchema } from "../../shared/movement/heavySchema";
import { articulatedBodySchema, articulatedEvidenceSchema } from "../../shared/movement/articulatedSchema";

export const LandmarkSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  visibility: z.number().optional(),
});

const Vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const BodySkeletonSchema = z.object({
  representation: z.literal("rtmw3d-body-v1"), checkpoint: z.string().min(1),
  joints: z.array(Vector3Schema).length(12), confidence: z.array(z.number().min(0).max(1)).length(12),
  bones: z.array(Vector3Schema).length(12), boneConfidence: z.array(z.number().min(0).max(1)).length(12),
  depthConfidence: z.array(z.number()), orientationReliable: z.boolean(), root: Vector3Schema,
  scale: z.number().positive(), basis: z.array(Vector3Schema).length(3), cameraAssumption: z.string(),
  imageSize: z.tuple([z.number().positive(), z.number().positive()]).optional(),
});

export const NormalizedPoseGeometrySchema = z.object({
  articulated3d: articulatedBodySchema.optional(),
  timestampMs: z.number().optional(),
  body3d: heavyBodySchema.optional(),
  landmarks: z.array(LandmarkSchema),
  bodySkeleton: BodySkeletonSchema.optional(),
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
    .array(z.object({ ph: z.enum(["outbound", "apex", "return", "sequence"]), t: z.string().min(3).max(160) }))
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
            bodySkeleton: BodySkeletonSchema.optional(),
            body3d: heavyBodySchema.optional(),
            articulated3d: articulatedBodySchema.optional(),
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
    schemaVersion: z.union([z.literal(2), z.literal(3)]).optional(),
    representation: z.enum(["rtmw3d-body-v1","mediapipe-heavy-body3d-v1","mediapipe-articulated-3d-v1"]).optional(),
    articulatedTolerance: z.number().positive().max(1).optional(),
    statisticalCalibration: teacherCalibrationSchema.optional(),
    references: z.array(z.object({
      articulatedEvidence: articulatedEvidenceSchema.optional(),
      trajectoryEvidence: trajectoryEvidenceSchema.optional(),
      anchorConstruction: z.literal("observed-regions-v1").optional(), quality: referenceQualitySchema(NormalizedPoseSchema).optional(),
      demonstrationId: z.string(), teacherConfirmed: z.boolean(), alignmentEligible: z.boolean(), rejectionReason: z.string().optional(), sourceTrajectory: z.array(NormalizedPoseSchema).min(2),
      samples: z.array(z.object({ progress01: z.number().min(0).max(1), phase: z.enum(["outbound", "apex", "return", "sequence"]), pose: NormalizedPoseGeometrySchema })),
      anchors: z.array(z.object({ id: z.enum(["start", "apex", "completion"]), progress01: z.number().min(0).max(1), phase: z.enum(["outbound", "apex", "return", "sequence"]), pose: NormalizedPoseGeometrySchema, holdMs: z.number().nonnegative(), holdSource: z.literal("teacher_requested").optional(), region: observedRegionSchema(NormalizedPoseSchema).optional() })),
    })).min(1).optional(),
    kind: z.enum(["cycle", "sequence"]).optional(),
    trajectorySource: z.enum(["dense_samples", "demonstration_trajectories", "legacy_checkpoints", "coherent_3d_references"]).optional(),
    samples: z.array(z.object({
      progress01: z.number().min(0).max(1),
      phase: z.enum(["outbound", "apex", "return", "sequence"]),
      pose: NormalizedPoseGeometrySchema,
    })).optional(),
    anchors: z.array(z.object({
      id: z.enum(["start", "apex", "completion"]),
      progress01: z.number().min(0).max(1),
      phase: z.enum(["outbound", "apex", "return", "sequence"]),
      pose: NormalizedPoseGeometrySchema,
      holdMs: z.number().nonnegative(),
      holdSource: z.literal("teacher_requested").optional(),
      region: observedRegionSchema(NormalizedPoseSchema).optional(),
    })).optional(),
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
        phase: z.enum(["outbound", "apex", "return", "sequence"]),
        pose: NormalizedPoseGeometrySchema,
      }),
    ),
  }).superRefine((canonical, context) => {
    const reject = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    const allGeometry=[...(canonical.samples??[]).map(s => s.pose),...canonical.checkpoints.map(c => c.pose),...(canonical.anchors??[]).map(a => a.pose),
      ...(canonical.references??[]).flatMap(r => [...r.sourceTrajectory,...r.samples.map(s => s.pose),...r.anchors.map(a => a.pose)])];
    if(canonical.representation!=="mediapipe-articulated-3d-v1" && allGeometry.some(p => p.articulated3d)) reject("Articulated geometry requires its distinct representation");
    if (canonical.schemaVersion !== 3) {
      if (canonical.representation === "mediapipe-heavy-body3d-v1" || canonical.samples?.some(s => s.pose.body3d) || canonical.checkpoints.some(c => c.pose.body3d)) reject("Heavy geometry requires its versioned v3 representation");
      return;
    }
    if(canonical.representation==="mediapipe-articulated-3d-v1") {
      if(!canonical.articulatedTolerance || canonical.statisticalCalibration) reject("Articulated lessons require fixed tolerance, not covariance calibration");
      if(!canonical.references?.some(r => r.teacherConfirmed&&r.alignmentEligible)) reject("Confirm one coherent articulated execution");
      if(allGeometry.some(p => !p.articulated3d || p.body3d || p.bodySkeleton)) reject("Mixed articulated lesson geometry");
      for(const r of canonical.references??[]) {
        if(!r.articulatedEvidence) reject("Missing observed articulated source evidence");
        if(!r.alignmentEligible) {if(!r.rejectionReason) reject("Rejected references need reasons");continue;}
        if(r.samples.length<3 || r.samples[0]?.progress01!==0 || r.samples.at(-1)?.progress01!==1 ||
          r.samples.some((s,i) => i>0&&s.progress01<=r.samples[i-1]!.progress01 ||
            !r.sourceTrajectory.some(p => p.timestampMs===s.pose.timestampMs && JSON.stringify(p.articulated3d)===JSON.stringify(s.pose.articulated3d)))) reject("Articulated references require ordered actual source observations");
        if(JSON.stringify(r.anchors.map(a => a.id))!==JSON.stringify(["start","completion"]) || r.anchors.some(a => a.holdMs>0&&a.holdSource!=="teacher_requested")) reject("No generated apex or dwell in articulated references");
      }
      return;
    }
    if (canonical.representation === "mediapipe-heavy-body3d-v1") {
      if (!canonical.statisticalCalibration || !canonical.references?.some(r => r.alignmentEligible && r.teacherConfirmed)) reject("Heavy lessons require teacher-only calibration and a confirmed reference");
      for (const reference of canonical.references ?? []) {
        if (!canonical.statisticalCalibration?.teacherIds.includes(reference.demonstrationId)) reject("Reference absent from teacher calibration provenance");
        if (!reference.trajectoryEvidence || reference.sourceTrajectory.some(p => !p.body3d || p.bodySkeleton)) reject("Heavy reference contains incompatible geometry or lacks trajectory evidence");
        if (!reference.alignmentEligible) { if (!reference.rejectionReason) reject("Rejected sources require reasons"); continue; }
        if (reference.trajectoryEvidence?.rejectionReasons.length) reject("Eligible trajectory has unresolved quality failures");
        if (JSON.stringify(reference.anchors.map(a => a.id)) !== JSON.stringify(["start","completion"])) reject("Generic Heavy trajectories require start and terminal, not apex");
        if (reference.samples.length<3 || reference.samples[0]?.progress01!==0 || reference.samples.at(-1)?.progress01!==1) reject("Incomplete Heavy trajectory");
        if (reference.samples.some((s,i) => !s.pose.body3d || s.pose.bodySkeleton || s.phase!=="sequence" || i>0 && s.progress01<=reference.samples[i-1]!.progress01 ||
            !reference.sourceTrajectory.some(p => p.timestampMs===(s.pose as {timestampMs?:number}).timestampMs && JSON.stringify(p.body3d)===JSON.stringify(s.pose.body3d)))) reject("Heavy samples must be ordered coherent source observations");
        if (reference.anchors.some(a => a.holdMs>0 && a.holdSource!=="teacher_requested")) reject("Generated Heavy holds must be zero");
      }
      if (canonical.samples?.some(s => !s.pose.body3d || s.pose.bodySkeleton) || canonical.checkpoints.some(c => !c.pose.body3d || c.pose.bodySkeleton) ||
          canonical.anchors?.some(a => !a.pose.body3d || a.pose.bodySkeleton || a.id==="apex")) reject("Mixed Heavy preview/anchor geometry");
      return;
    }
    if (canonical.representation !== "rtmw3d-body-v1" || !canonical.references?.length) { reject("3D lessons require a versioned reference set"); return; }
    if (!canonical.references.some((r) => r.alignmentEligible && r.teacherConfirmed)) reject("3D lessons require a confirmed usable reference");
    for (const reference of canonical.references) {
      if (reference.sourceTrajectory.some(p => p.body3d) || reference.samples.some(s => s.pose.body3d) || reference.anchors.some(a => a.pose.body3d)) reject("Heavy geometry cannot be scored as RTMW3D");
      if (reference.sourceTrajectory.some((p) => !p.bodySkeleton)) reject("Legacy geometry cannot be persisted as RTMW3D");
      if (reference.anchorConstruction && !reference.quality) reject("Observed regions require source quality metadata");
      if (reference.alignmentEligible === false) {
        if (!reference.rejectionReason) reject("Unusable references require an explicit reason");
        continue;
      }
      const ids = canonical.kind === "sequence" ? ["start","completion"] : ["start","apex","completion"];
      if (JSON.stringify(reference.anchors.map((a) => a.id)) !== JSON.stringify(ids)) reject("Invalid 3D semantic anchors");
      if (reference.samples.length < 2 || reference.samples[0]?.progress01 !== 0 || reference.samples.at(-1)?.progress01 !== 1) reject("Incomplete 3D reference path");
      if (reference.samples.some((s, i) => !s.pose.bodySkeleton || (i > 0 && s.progress01 < reference.samples[i - 1]!.progress01))) reject("3D paths require ordered source geometry");
      if (reference.anchors.some((a) => !a.pose.bodySkeleton)) reject("3D anchors require real 3D geometry");
      if (reference.anchorConstruction) {
        if (reference.quality?.rejectionReasons.length) reject("Eligible regions cannot carry unresolved quality failures");
        for (const anchor of reference.anchors) {
          const r = anchor.region;
          if (!r || r.samples.length < 2 || r.endMs <= r.startMs || r.endSourceIndex <= r.startSourceIndex) { reject("Insufficient observed anchor region"); continue; }
          if (r.samples[0]!.timestampMs !== r.startMs || r.samples.at(-1)!.timestampMs !== r.endMs ||
              r.samples.some((p, i) => !p.bodySkeleton || (i > 0 && p.timestampMs <= r.samples[i - 1]!.timestampMs) ||
                !reference.sourceTrajectory.slice(r.startSourceIndex, r.endSourceIndex + 1).some((source) => source.timestampMs === p.timestampMs && JSON.stringify(source.bodySkeleton) === JSON.stringify(p.bodySkeleton)))) reject("Anchor regions require ordered actual source geometry");
        }
      }
    }
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
