import { angleDegrees, distance2d } from "../../shared/utils/math";
import { POSE_LANDMARK, type Landmark, type NormalizedLandmark } from "./pose.types";

export function midpoint(
  a: Landmark | NormalizedLandmark,
  b: Landmark | NormalizedLandmark,
): { x: number; y: number; z: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export function hipMidpoint(landmarks: Array<Landmark | NormalizedLandmark>) {
  const left = landmarks[POSE_LANDMARK.LEFT_HIP];
  const right = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!left || !right) return null;
  return midpoint(left, right);
}

export function shoulderWidth(landmarks: Array<Landmark | NormalizedLandmark>): number {
  const left = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const right = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  if (!left || !right) return 0;
  return distance2d(left.x, left.y, right.x, right.y);
}

export function hipWidth(landmarks: Array<Landmark | NormalizedLandmark>): number {
  const left = landmarks[POSE_LANDMARK.LEFT_HIP];
  const right = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!left || !right) return 0;
  return distance2d(left.x, left.y, right.x, right.y);
}

export function torsoLength(landmarks: Array<Landmark | NormalizedLandmark>): number {
  const leftShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const rightShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  const leftHip = landmarks[POSE_LANDMARK.LEFT_HIP];
  const rightHip = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 0;
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  return distance2d(shoulderMid.x, shoulderMid.y, hipMid.x, hipMid.y);
}

export function jointAngle(
  landmarks: Array<Landmark | NormalizedLandmark>,
  a: number,
  b: number,
  c: number,
): number | null {
  const pa = landmarks[a];
  const pb = landmarks[b];
  const pc = landmarks[c];
  if (!pa || !pb || !pc) return null;
  return angleDegrees(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y);
}

export function meanVisibility(landmarks: Array<Landmark | NormalizedLandmark>): number {
  if (landmarks.length === 0) return 0;
  let sum = 0;
  for (const lm of landmarks) sum += lm.visibility ?? 0;
  return sum / landmarks.length;
}

export function landmarkVisibilityMap(
  landmarks: Array<Landmark | NormalizedLandmark>,
  indices: number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const index of indices) {
    out[String(index)] = landmarks[index]?.visibility ?? 0;
  }
  return out;
}
