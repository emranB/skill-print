import { clamp } from "../../shared/utils/math";
import { poseSimilarity } from "./PoseDistance";
import { anglePenalty } from "./PoseAngles";
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
    angleWeight?: number;
  },
): CompareResult {
  const requiredSimilarity = clamp(1 - options.leniency, 0.15, 0.95);
  const positionalSimilarity = poseSimilarity(student, target, {
    minimumVisibility: options.minimumVisibility,
    planar: true,
  });
  const similarity = Math.max(0, positionalSimilarity - anglePenalty(student, target, options.minimumVisibility, options.angleWeight).penalty);
  const trackingValid = options.trackingValid;
  const passed = trackingValid && similarity >= requiredSimilarity;
  return {
    similarity,
    trackingValid,
    requiredSimilarity,
    passed,
  };
}
