import { clamp } from "../../shared/utils/math";
import { poseSimilarity } from "./PoseDistance";
import type { NormalizedPoseGeometry } from "./pose.types";

export interface CompareResult {
  similarity: number;
  trackingValid: boolean;
  requiredSimilarity: number;
  passed: boolean;
}

export function comparePose(
  student: NormalizedPoseGeometry,
  target: NormalizedPoseGeometry,
  options: {
    leniency: number;
    minimumVisibility: number;
    trackingValid: boolean;
  },
): CompareResult {
  const requiredSimilarity = clamp(1 - options.leniency, 0.15, 0.95);
  const similarity = poseSimilarity(student, target, {
    minimumVisibility: options.minimumVisibility,
    planar: true,
  });
  const trackingValid = options.trackingValid;
  const passed = trackingValid && similarity >= requiredSimilarity;
  return {
    similarity,
    trackingValid,
    requiredSimilarity,
    passed,
  };
}
