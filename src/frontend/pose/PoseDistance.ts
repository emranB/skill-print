import type { NormalizedPoseGeometry } from "./pose.types";

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
