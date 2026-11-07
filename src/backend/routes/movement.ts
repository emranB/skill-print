import { Router } from "express";
import { z } from "zod";
import { movementWorker } from "../services/MovementWorker.js";

const vectorSchema = z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const skeletonSchema = z.object({ representation: z.literal("rtmw3d-body-v1"), checkpoint: z.string(),
  joints: z.array(vectorSchema).length(12), confidence: z.array(z.number().min(0).max(1)).length(12),
  bones: z.array(vectorSchema).length(12), boneConfidence: z.array(z.number().min(0).max(1)).length(12),
  orientationReliable: z.boolean(), depthConfidence: z.array(z.number()), root: vectorSchema, scale: z.number().positive(),
  basis: z.array(vectorSchema).length(3), cameraAssumption: z.string(), imageSize: z.tuple([z.number(),z.number()]).optional() });
const sampleSchema = z.object({ progress01: z.number().min(0).max(1), phase: z.enum(["outbound","apex","return","sequence"]),
  pose: z.object({ bodySkeleton: skeletonSchema, landmarks: z.array(z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), visibility: z.number().optional() })) }) });
const regionPoseSchema = sampleSchema.shape.pose.extend({ timestampMs: z.number().finite().nonnegative() });
// The server is compiled as a separate root; keep its wire schema independent of client imports.
const regionSchema = z.object({ startSourceIndex: z.number().int().nonnegative(), endSourceIndex: z.number().int().nonnegative(),
  startMs: z.number().finite().nonnegative(), endMs: z.number().finite().nonnegative(), samples: z.array(regionPoseSchema).min(1).max(4096),
  diameter: z.number().finite().nonnegative(), maximumSpeed: z.number().finite().nonnegative() });
const anchorSchema = sampleSchema.extend({ id: z.enum(["start","apex","completion"]), holdMs: z.number().nonnegative(), holdSource: z.literal("teacher_requested").optional(), region: regionSchema.optional() });
const referenceSchema = z.object({ demonstrationId: z.string(), teacherConfirmed: z.boolean(), alignmentEligible: z.boolean(),
  anchorConstruction: z.literal("observed-regions-v1").optional(),
  samples: z.array(sampleSchema).max(4096), anchors: z.array(anchorSchema).max(3) });
const canonicalSchema = z.object({ schemaVersion: z.literal(3), representation: z.literal("rtmw3d-body-v1"), kind: z.enum(["cycle","sequence"]),
  references: z.array(referenceSchema).min(1).max(32) }).refine((canonical) => canonical.references.every((r) => r.alignmentEligible === false ||
    (r.samples.length >= 2 && r.samples[0]!.progress01 === 0 && r.samples.at(-1)!.progress01 === 1 &&
     r.samples.every((s,i) => i === 0 || s.progress01 >= r.samples[i-1]!.progress01) &&
     JSON.stringify(r.anchors.map((a) => a.id)) === JSON.stringify(canonical.kind === "cycle" ? ["start","apex","completion"] : ["start","completion"]) &&
     (!r.anchorConstruction || r.anchors.every((a) => a.region && a.region.samples.length >= 2 && a.region.endMs > a.region.startMs &&
       a.region.endSourceIndex > a.region.startSourceIndex && a.region.samples[0]!.timestampMs === a.region.startMs && a.region.samples.at(-1)!.timestampMs === a.region.endMs &&
       a.region.samples.every((p,i) => (i === 0 || p.timestampMs > a.region!.samples[i-1]!.timestampMs) && r.samples.some((s) => JSON.stringify(s.pose.bodySkeleton) === JSON.stringify(p.bodySkeleton))))))));

export const movementRouter = Router();
// Bound inference and explicit align share local cursors; missing geometry supplies no hold time.
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("status") }),
  z.object({ operation: z.literal("infer"), streamId: z.string().uuid(), image: z.string().min(1).max(1_000_000).regex(/^[A-Za-z0-9+/=]+$/), timestampMs: z.number().finite().nonnegative() }),
  z.object({ operation: z.literal("start"), runId: z.string().uuid(), streamId: z.string().uuid().optional(), canonical: canonicalSchema, difficulty: z.number().int().min(1).max(100), leniency: z.number().min(0.01).max(0.5) }),
  z.object({ operation: z.literal("bind"), runId: z.string().uuid(), streamId: z.string().uuid() }),
  z.object({ operation: z.literal("align"), runId: z.string().uuid(), pose: z.object({ timestampMs: z.number().finite().nonnegative(), bodySkeleton: skeletonSchema }) }),
  z.object({ operation: z.literal("finish"), runId: z.string().uuid() }),
]);

movementRouter.post("/movement", async (req, res) => {
  const request = requestSchema.safeParse(req.body);
  if (!request.success) { res.status(400).json({ error: "Invalid movement request" }); return; }
  try { res.json(await movementWorker.call(request.data)); }
  catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : "Movement runtime unavailable" }); }
});
