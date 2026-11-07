import { z } from "zod";
import { ARTICULATED_REPRESENTATION } from "./ArticulatedBody";
import { HEAVY_HASH } from "./HeavyBody";
const scalar = z.number().finite();
const vector = z.tuple([scalar, scalar, scalar]);
const confidence = (length: number) => z.array(scalar.min(0).max(1)).length(length);
export const articulatedBodySchema = z
  .object({
    representation: z.literal(ARTICULATED_REPRESENTATION),
    modelHash: z.literal(HEAVY_HASH),
    joints: z.array(vector.nullable()).length(12),
    confidence: confidence(12),
    bones: z.array(vector.nullable()).length(11),
    boneConfidence: confidence(11),
    bends: z.array(scalar.min(0).max(Math.PI).nullable()).length(8),
    bendConfidence: confidence(8),
    root: vector,
    scale: scalar.positive(),
    basis: z.array(vector).length(3),
    orientationReliable: z.boolean(),
  })
  .superRefine((body, ctx) => {
    if (
      body.bones.some((v, i) =>
        v === null ? body.boneConfidence[i] !== 0 : Math.abs(Math.hypot(...v) - 1) > 1e-5,
      ) ||
      body.bends.some((v, i) => v === null && body.bendConfidence[i] !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Articulated bones must be unit directions with explicit missing-feature confidence",
      });
  });
export const articulatedEvidenceSchema = z.object({
  sourceIndices: z.array(scalar.int().nonnegative()),
  arcLength: scalar.nonnegative(),
  excursion: scalar.nonnegative(),
  rejectionReasons: z.array(z.string()),
});
