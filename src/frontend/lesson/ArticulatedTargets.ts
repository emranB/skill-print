import {
  articulatedDistance,
  interpolateArticulated,
  usableArticulated,
} from "../../shared/movement/ArticulatedBody";
import type { NormalizedPose } from "../pose/pose.types";

export const MAX_TRAJECTORY_TARGETS = 20;

export function difficultyToTargetCount(difficulty: number): number {
  const value = Number.isFinite(difficulty) ? Math.round(difficulty) : 75;
  return 4 + Math.round((16 * (Math.max(1, Math.min(100, value)) - 1)) / 99);
}

/** Nested geometric simplification: endpoints and largest turns first, then arc coverage. */
export function selectArticulatedTargets(path: NormalizedPose[], count = MAX_TRAJECTORY_TARGETS) {
  const indices: number[] = [];
  for (let i = 0; i < path.length; i++) {
    if (!usableArticulated(path[i]!.articulated3d)) continue;
    const previous = indices.at(-1);
    if (
      previous === undefined ||
      articulatedDistance(path[previous]!.articulated3d!, path[i]!.articulated3d!).worst > 1e-7
    )
      indices.push(i);
    else if (i === path.length - 1 && indices.length > 1) indices[indices.length - 1] = i;
  }
  if (indices.length < 2) return [];
  const arc = [0];
  for (let i = 1; i < indices.length; i++)
    arc.push(
      arc[i - 1]! +
        articulatedDistance(
          path[indices[i - 1]!]!.articulated3d!,
          path[indices[i]!]!.articulated3d!,
        ).worst,
    );
  const keep = new Set([0, indices.length - 1]);
  const limit = Math.min(MAX_TRAJECTORY_TARGETS, Math.max(3, Math.round(count)), indices.length);
  while (keep.size < limit) {
    const selected = [...keep].sort((a, b) => a - b);
    let best = -1,
      importance = -1;
    for (let j = 1; j < selected.length; j++) {
      const a = selected[j - 1]!,
        b = selected[j]!;
      for (let i = a + 1; i < b; i++) {
        const fraction = (arc[i]! - arc[a]!) / Math.max(1e-9, arc[b]! - arc[a]!);
        const error = articulatedDistance(
          path[indices[i]!]!.articulated3d!,
          interpolateArticulated(
            path[indices[a]!]!.articulated3d!,
            path[indices[b]!]!.articulated3d!,
            fraction,
          ),
        ).worst;
        // A straight segment still receives geometric coverage; pauses add no arc.
        const priority = error + Math.min(arc[i]! - arc[a]!, arc[b]! - arc[i]!) / 8;
        if (priority > importance) {
          importance = priority;
          best = i;
        }
      }
    }
    if (best < 0) break;
    keep.add(best);
  }
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => ({
      sourceIndex: indices[i]!,
      progress01: arc[i]! / Math.max(1e-9, arc.at(-1)!),
      phase: "sequence" as const,
      pose: path[indices[i]!]!,
    }));
}
