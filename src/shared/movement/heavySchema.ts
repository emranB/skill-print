import { z } from "zod";
import { HEAVY_REPRESENTATION, HEAVY_HASH } from "./HeavyBody";
const scalar=z.number().finite();
const vector=z.tuple([scalar,scalar,scalar]);
const confidence=z.array(scalar.min(0).max(1)).length(48);
const matrix=z.array(z.array(scalar).length(48)).length(48);
export const heavyBodySchema=z.object({
  representation:z.literal(HEAVY_REPRESENTATION),modelHash:z.literal(HEAVY_HASH),
  joints:z.array(vector.nullable()).length(12),bones:z.array(vector.nullable()).length(12),
  confidence:z.array(scalar.min(0).max(1)).length(12),boneConfidence:z.array(scalar.min(0).max(1)).length(12),
  features:z.array(scalar.nullable()).length(48),featureConfidence:confidence,
  root:vector,scale:scalar.positive(),basis:z.array(vector).length(3),orientationReliable:z.boolean(),
}).superRefine((b,c) => {
  if(b.features.some((v,i) => v===null && b.featureConfidence[i]!==0)) c.addIssue({code:"custom",message:"Missing features must have zero confidence"});
});
export const teacherCalibrationSchema=z.object({
  method:z.literal("teacher-oas-cholesky-v1"),dimension:z.literal(48),teacherIds:z.array(z.string()).min(1),sampleCount:scalar.int().positive(),
  shrinkage:scalar.min(0).max(1),weights:z.array(scalar.positive().max(1)).length(48),covariance:matrix,whitening:matrix,
  tolerance:scalar.positive(),noise:scalar.nonnegative(),fallback:z.string().nullable(),
});
export const trajectoryEvidenceSchema=z.object({
  construction:z.literal("observed-trajectory-v1"),representation:z.literal(HEAVY_REPRESENTATION),sourceIndices:z.array(scalar.int().nonnegative()),
  arcLength:scalar.nonnegative(),excursion:scalar.nonnegative(),noise:scalar.nonnegative(),maximumGapMs:scalar.nonnegative(),
  terminalStartDistance:scalar.nonnegative(),kind:z.enum(["cycle","sequence"]),
  maximumNeighborError:scalar.nonnegative(),
  startSourceIndex:scalar.int().nonnegative(),terminalSourceIndex:scalar.int().nonnegative(),rejectionReasons:z.array(z.string()),
});
