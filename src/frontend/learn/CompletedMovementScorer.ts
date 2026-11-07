import { articulatedDistance, type ArticulatedBody } from "../../shared/movement/ArticulatedBody";
import type { NormalizedPose } from "../pose/pose.types";

export const MAX_ALIGNMENT_SAMPLES = 100;

/** Bounded geometric resampling, retaining actual observations and endpoints, never time percentages. */
export function compactExecution(
  path: NormalizedPose[],
  limit = MAX_ALIGNMENT_SAMPLES,
): NormalizedPose[] {
  if (path.length <= limit) return path;
  const arc = [0];
  for (let i = 1; i < path.length; i++)
    arc.push(
      arc[i - 1]! + articulatedDistance(path[i - 1]!.articulated3d!, path[i]!.articulated3d!).worst,
    );
  return Array.from({ length: limit }, (_, i) => {
    const target = (arc.at(-1)! * i) / (limit - 1);
    const index = arc.findIndex((v) => v >= target);
    return path[index < 0 ? path.length - 1 : index]!;
  });
}

/** Run ONLY at a completed candidate boundary, never over growing online history. */
export function scoreCompletedMovement(candidate: NormalizedPose[], teacher: ArticulatedBody[]) {
  const source = compactExecution(candidate).map((p) => p.articulated3d!);
  const n = source.length,
    m = teacher.length;
  const started = performance.now();
  if (n < 3 || m < 3 || n > MAX_ALIGNMENT_SAMPLES || m > MAX_ALIGNMENT_SAMPLES)
    return {
      distance: Infinity,
      similarity: 0,
      meanPoseDistance: Infinity,
      worstFeature: null,
      alignmentMs: 0,
      pairs: 0,
    };
  const costs = Array.from({ length: n }, () => Array<number>(m).fill(Infinity));
  const previous = Array.from({ length: n }, () => Array<[number, number] | null>(m).fill(null));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      if (
        Math.abs(i / (n - 1) - j / (m - 1)) > 0.35 &&
        !(i === 0 && j === 0) &&
        !(i === n - 1 && j === m - 1)
      )
        continue;
      const distance = articulatedDistance(source[i]!, teacher[j]!).distance;
      if (i === 0 && j === 0) {
        costs[i]![j] = distance;
        continue;
      }
      const neighbors: Array<[number, number]> = [];
      if (i > 0 && j > 0) neighbors.push([i - 1, j - 1]);
      if (i > 0) neighbors.push([i - 1, j]);
      if (j > 0) neighbors.push([i, j - 1]);
      const best = neighbors.sort((a, b) => costs[a[0]]![a[1]]! - costs[b[0]]![b[1]]!)[0]!;
      costs[i]![j] = distance + costs[best[0]]![best[1]]!;
      previous[i]![j] = best;
    }
  const aligned: Array<[number, number]> = [];
  let cursor: [number, number] | null = [n - 1, m - 1];
  if (Number.isFinite(costs[n - 1]![m - 1]))
    while (cursor) {
      aligned.push(cursor);
      cursor = previous[cursor[0]]![cursor[1]];
    }
  const boneSums = Array<number>(11).fill(0),
    boneCounts = Array<number>(11).fill(0),
    bendSums = Array<number>(8).fill(0),
    bendCounts = Array<number>(8).fill(0);
  let sum = 0;
  const stageSupport = Array<number>(m).fill(Infinity);
  for (const [i, j] of aligned) {
    const error = articulatedDistance(source[i]!, teacher[j]!);
    sum += error.distance;
    stageSupport[j] = Math.min(stageSupport[j]!, error.worst);
    error.bones.forEach((v, k) => {
      if (v !== null) {
        boneSums[k]! += v;
        boneCounts[k]!++;
      }
    });
    error.bends.forEach((v, k) => {
      if (v !== null) {
        bendSums[k]! += v;
        bendCounts[k]!++;
      }
    });
  }
  const features = [
    ...boneSums.map((v, i) => ({
      kind: "bone",
      index: i,
      distance: boneCounts[i] ? v / boneCounts[i]! : null,
    })),
    ...bendSums.map((v, i) => ({
      kind: "bend",
      index: i,
      distance: bendCounts[i] ? v / bendCounts[i]! : null,
    })),
  ];
  const worstFeature =
    features.filter((f) => f.distance !== null).sort((a, b) => b.distance! - a.distance!)[0] ??
    null;
  const meanPoseDistance = aligned.length ? sum / aligned.length : Infinity;
  // One fixed angular tolerance applies to the mean and each observed segment;
  // a wrong moving limb cannot be diluted by ten unchanged body segments.
  const unsupportedStage = Math.max(...stageSupport);
  const distance = Math.max(meanPoseDistance, worstFeature?.distance ?? Infinity, unsupportedStage);
  return {
    distance,
    similarity: Math.max(0, 1 - distance),
    meanPoseDistance,
    worstFeature,
    features,
    unsupportedStage,
    worstStage: stageSupport.indexOf(unsupportedStage),
    alignmentMs: performance.now() - started,
    pairs: aligned.length,
  };
}
