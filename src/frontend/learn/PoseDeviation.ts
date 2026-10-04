import { JOINT_NAMES, MAJOR_JOINTS } from "../pose/PoseUsability";
import type { NormalizedPoseGeometry } from "../pose/pose.types";

/** Below this planar distance (in body-scale units) a joint is close enough not to mention. */
const MIN_DEVIATION = 0.15;

export interface PoseDeviation {
  joint: number;
  name: string;
  /** Which way the student's joint must move to reach the teacher's. */
  direction: "higher" | "lower" | "in" | "out";
  distance: number;
}

/**
 * The visible major joint farthest from the teacher's checkpoint, in the
 * hip-centred, body-scaled plane both poses share. Image y grows downward,
 * so a larger student y means the joint must move higher.
 */
export function largestDeviation(
  student: NormalizedPoseGeometry,
  target: NormalizedPoseGeometry,
  floor: number,
): PoseDeviation | null {
  let best: PoseDeviation | null = null;
  for (const joint of MAJOR_JOINTS) {
    const s = student.landmarks[joint];
    const t = target.landmarks[joint];
    if (!s || !t || (s.visibility ?? 0) < floor || (t.visibility ?? 1) < floor) continue;
    const dx = Math.abs(s.x) - Math.abs(t.x);
    const dy = s.y - t.y;
    const distance = Math.hypot(s.x - t.x, dy);
    if (distance < MIN_DEVIATION || (best && distance <= best.distance)) continue;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    best = {
      joint,
      name: JOINT_NAMES[joint] ?? `joint ${joint}`,
      direction: vertical ? (dy > 0 ? "higher" : "lower") : dx > 0 ? "in" : "out",
      distance,
    };
  }
  return best;
}

export function describeDeviation(deviation: PoseDeviation): string {
  switch (deviation.direction) {
    case "higher":
      return `Bring your ${deviation.name} higher.`;
    case "lower":
      return `Bring your ${deviation.name} lower.`;
    case "in":
      return `Bring your ${deviation.name} in closer to your body.`;
    case "out":
      return `Move your ${deviation.name} further out.`;
  }
}
