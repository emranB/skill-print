import { jointAngle } from "./PoseGeometry";
import type { NormalizedPoseGeometry } from "./pose.types";

export const ANGLE_CHAINS = [
  { name: "left_elbow", indices: [11, 13, 15] },
  { name: "right_elbow", indices: [12, 14, 16] },
  { name: "left_hip", indices: [11, 23, 25] },
  { name: "right_hip", indices: [12, 24, 26] },
  { name: "left_knee", indices: [23, 25, 27] },
  { name: "right_knee", indices: [24, 26, 28] },
] as const;
export const MIN_ANGLE_LIMB_LENGTH = 0.1;
export const MIN_RELIABLE_ANGLE_CHAINS = 3;
export const MAX_ANGLE_WEIGHT = 0.05;
export const ANGLE_VISIBILITY_FLOOR = 0.8;

function reliableAngle(pose: NormalizedPoseGeometry, indices: readonly [number, number, number], floor: number) {
  const [a, b, c] = indices.map((i) => pose.landmarks[i]);
  if (!a || !b || !c || [a, b, c].some((p) => (p.visibility ?? 0) < floor)) return null;
  if (Math.min(Math.hypot(a.x - b.x, a.y - b.y), Math.hypot(c.x - b.x, c.y - b.y)) < MIN_ANGLE_LIMB_LENGTH) return null;
  const angle = jointAngle(pose.landmarks, ...indices);
  return angle !== null && Number.isFinite(angle) ? angle : null;
}

/** Planar joint angles are diagnostic unless an independently configured weight is enabled. */
export function measureAngleErrors(student: NormalizedPoseGeometry, teacher: NormalizedPoseGeometry, minimumVisibility: number) {
  return ANGLE_CHAINS.flatMap(({ name, indices }) => {
    const a = reliableAngle(student, indices, minimumVisibility);
    const b = reliableAngle(teacher, indices, minimumVisibility);
    return a === null || b === null ? [] : [{ name, studentDegrees: a, teacherDegrees: b, errorDegrees: Math.abs(a - b) }];
  });
}

/** Optional bounded penalty only: missing or projected-out geometry never becomes a hard failure. */
export function anglePenalty(student: NormalizedPoseGeometry, teacher: NormalizedPoseGeometry, minimumVisibility: number, weight = 0) {
  const boundedWeight = Number.isFinite(weight) ? Math.max(0, Math.min(MAX_ANGLE_WEIGHT, weight)) : 0;
  if (!boundedWeight) return { penalty: 0, reliableChains: 0 };
  const errors = measureAngleErrors(student, teacher, Math.max(ANGLE_VISIBILITY_FLOOR, minimumVisibility));
  const penalty = errors.length < MIN_RELIABLE_ANGLE_CHAINS ? 0
    : boundedWeight * errors.reduce((sum, e) => sum + Math.min(1, e.errorDegrees / 90), 0) / errors.length;
  return { penalty, reliableChains: errors.length };
}
