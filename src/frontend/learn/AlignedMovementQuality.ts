import type { articulatedDistance } from "../../shared/movement/ArticulatedBody";

export type AlignedError = ReturnType<typeof articulatedDistance>;

/** Quality summarizes the very same reached targets; it never vetoes completion. */
export function scoreAlignedTargets(errors: AlignedError[]) {
  const started = performance.now();
  const mean = (values: Array<number | null>) => {
    const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
    return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
  };
  const distance = mean(errors.map((e) => e.distance)) ?? Infinity;
  const features = [
    ...Array.from({ length: 11 }, (_, index) => ({
      kind: "bone",
      index,
      distance: mean(errors.map((e) => e.bones[index] ?? null)),
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      kind: "bend",
      index,
      distance: mean(errors.map((e) => e.bends[index] ?? null)),
    })),
  ];
  const similarity = Math.max(0, 1 - distance);
  return {
    distance,
    similarity,
    qualityPercent: similarity * 100,
    meanPoseDistance: distance,
    features,
    worstFeature:
      features.filter((f) => f.distance !== null).sort((a, b) => b.distance! - a.distance!)[0] ??
      null,
    pairs: errors.length,
    alignmentMs: performance.now() - started,
  };
}
