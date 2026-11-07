import type { NormalizedPoseGeometry } from "./pose.types";
import { rawFeatureDistance, usableHeavy } from "../../shared/movement/HeavyBody";
import { articulatedDistance } from "../../shared/movement/ArticulatedBody";

const MAJOR_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface PoseDistanceOptions {
  minimumVisibility?: number;
  indices?: number[];
  /** Ignore the monocular depth estimate, which is far noisier than x/y. */
  planar?: boolean;
  /** Minimum number of joints that must pass the visibility floor. */
  minimumJoints?: number;
}

export function poseDistance(
  a: NormalizedPoseGeometry,
  b: NormalizedPoseGeometry,
  options?: PoseDistanceOptions,
): number {
  if(a.articulated3d || b.articulated3d) return a.articulated3d && b.articulated3d && !a.body3d && !b.body3d && !a.bodySkeleton && !b.bodySkeleton
    ? articulatedDistance(a.articulated3d,b.articulated3d).distance : Infinity;
  if (a.body3d || b.body3d) return usableHeavy(a.body3d) && usableHeavy(b.body3d)
    ? rawFeatureDistance(a.body3d,b.body3d) : Infinity;
  if (Boolean(a.bodySkeleton) !== Boolean(b.bodySkeleton)) return Infinity;
  if (a.bodySkeleton && b.bodySkeleton) {
    if (!a.bodySkeleton.orientationReliable || !b.bodySkeleton.orientationReliable) return Infinity;
    let squared = 0;
    let count = 0;
    a.bodySkeleton.bones.forEach((v, i) => {
      const w = b.bodySkeleton!.bones[i];
      if (!w || Math.min(a.bodySkeleton!.boneConfidence[i]!, b.bodySkeleton!.boneConfidence[i]!) < 0.5) return;
      squared += v.reduce((sum, x, j) => sum + (x - w[j]!) ** 2, 0);
      count++;
    });
    return count < 6 ? Infinity : Math.sqrt(squared / count);
  }
  const minimumVisibility = options?.minimumVisibility ?? 0.3;
  const indices = options?.indices ?? MAJOR_JOINTS;
  const planar = options?.planar ?? false;
  const minimumJoints = options?.minimumJoints ?? 1;
  let sum = 0;
  let count = 0;

  for (const index of indices) {
    const pa = a.landmarks[index];
    const pb = b.landmarks[index];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 0) < minimumVisibility || (pb.visibility ?? 0) < minimumVisibility) {
      continue;
    }
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    const dz = planar ? 0 : pa.z - pb.z;
    sum += Math.hypot(dx, dy, dz);
    count += 1;
  }

  if (count === 0 || count < minimumJoints) return Number.POSITIVE_INFINITY;
  return sum / count;
}

export function poseSimilarity(
  a: NormalizedPoseGeometry,
  b: NormalizedPoseGeometry,
  options?: PoseDistanceOptions,
): number {
  const distance = poseDistance(a, b, options);
  if (!Number.isFinite(distance)) return 0;
  // Map typical normalized distances into [0,1]
  return Math.max(0, Math.min(1, 1 - distance / 1.25));
}
