import { clamp } from "../../shared/utils/math";
import { hipMidpoint, hipWidth, shoulderWidth, torsoLength } from "./PoseGeometry";
import type {
  Landmark,
  NormalizedLandmark,
  NormalizedPose,
  NormalizedPoseGeometry,
  PoseFrame,
} from "./pose.types";

export function computeBodyScale(landmarks: Array<Landmark | NormalizedLandmark>): number {
  const torso = torsoLength(landmarks);
  const shoulders = shoulderWidth(landmarks);
  const hips = hipWidth(landmarks);
  const candidates = [torso, shoulders * 1.6, hips * 1.8].filter((v) => v > 1e-6);
  if (candidates.length === 0) return 1;
  return candidates.reduce((a, b) => a + b, 0) / candidates.length;
}

export function normalizeLandmarks(
  landmarks: Landmark[],
  _minimumVisibility = 0,
): NormalizedPoseGeometry {
  const origin = hipMidpoint(landmarks) ?? { x: 0.5, y: 0.5, z: 0 };
  const scale = Math.max(computeBodyScale(landmarks), 1e-4);

  const normalized: NormalizedLandmark[] = landmarks.map((lm) => {
    const visibility = lm.visibility ?? 0;
    const nx = (lm.x - origin.x) / scale;
    const ny = (lm.y - origin.y) / scale;
    const nz = (lm.z - origin.z) / scale;
    return {
      x: Number.isFinite(nx) ? nx : 0,
      y: Number.isFinite(ny) ? ny : 0,
      z: Number.isFinite(nz) ? nz : 0,
      visibility,
    };
  });

  return { landmarks: normalized };
}

export function normalizePose(frame: PoseFrame, minimumVisibility = 0): NormalizedPose {
  return {
    timestampMs: frame.timestampMs,
    ...normalizeLandmarks(frame.landmarks, minimumVisibility),
  };
}

export function scaleNormalizedToStudent(
  geometry: NormalizedPoseGeometry,
  studentScale: number,
  studentOrigin: { x: number; y: number; z: number },
): Landmark[] {
  const safeScale = Math.max(studentScale, 1e-4);
  return geometry.landmarks.map((lm) => ({
    x: clamp(lm.x * safeScale + studentOrigin.x, -2, 3),
    y: clamp(lm.y * safeScale + studentOrigin.y, -2, 3),
    z: lm.z * safeScale + studentOrigin.z,
    visibility: lm.visibility,
  }));
}
