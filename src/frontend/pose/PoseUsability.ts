import { hipWidth, shoulderWidth, torsoLength } from "./PoseGeometry";
import { computeBodyScale } from "./PoseNormalizer";
import { POSE_LANDMARK, type Landmark } from "./pose.types";

/** Shoulders, elbows, wrists, hips, knees, ankles. */
export const MAJOR_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export const JOINT_NAMES: Record<number, string> = {
  11: "left shoulder",
  12: "right shoulder",
  13: "left elbow",
  14: "right elbow",
  15: "left wrist",
  16: "right wrist",
  23: "left hip",
  24: "right hip",
  25: "left knee",
  26: "right knee",
  27: "left ankle",
  28: "right ankle",
};

/** Major joints below the visibility floor, in head-to-foot order. */
export function missingJoints(landmarks: Landmark[], floor: number): number[] {
  return MAJOR_JOINTS.filter((index) => (landmarks[index]?.visibility ?? 0) < floor);
}

/**
 * Plain framing advice for the joints the camera cannot see. Generic body
 * regions only; it says nothing about any particular skill.
 */
export function framingHint(missing: number[]): string | null {
  if (missing.length === 0) return null;
  const has = (...joints: number[]) => joints.some((j) => missing.includes(j));
  const legs = has(25, 26, 27, 28);
  const arms = has(13, 14, 15, 16);
  const torso = has(11, 12, 23, 24);
  if (legs && arms && torso) return "Step back until your whole body, head to feet, is inside the frame.";
  if (legs && torso) return "Step back or tilt the camera down so your hips, knees and feet are in view.";
  if (legs) return "Step back or tilt the camera down so your knees and feet are in view.";
  if (arms) return "Keep both arms inside the frame, or step back a little.";
  return "Face the camera a little more so both shoulders and hips are visible.";
}

/** Half the major joints: enough body for analysis, segmentation and live tracking. */
export const MIN_USABLE_JOINTS = MAJOR_JOINTS.length / 2;

/** Smallest normalization scale (fraction of the image) at which geometry is meaningful. */
export const MIN_BODY_SCALE = 0.05;

/** Visibility floor for usability checks; MediaPipe side views rarely exceed 0.5 on the far side. */
export function usabilityFloor(minimumVisibility = 0.5): number {
  return Math.min(minimumVisibility, 0.5);
}

export function visibleJointCount(landmarks: Landmark[], floor: number): number {
  let count = 0;
  for (const index of MAJOR_JOINTS) if ((landmarks[index]?.visibility ?? 0) >= floor) count += 1;
  return count;
}

export function isUsablePose(landmarks: Landmark[], floor: number): boolean {
  return visibleJointCount(landmarks, floor) >= MIN_USABLE_JOINTS;
}

/**
 * Body scale can be initialised when a shoulder and a hip anchor are visible
 * (side views hide one of each) and the body is not a speck in the image.
 */
export function bodyScaleEvidence(landmarks: Landmark[], floor: number): { ok: boolean; scale: number } {
  const vis = (i: number) => (landmarks[i]?.visibility ?? 0) >= floor;
  const shoulder = vis(POSE_LANDMARK.LEFT_SHOULDER) || vis(POSE_LANDMARK.RIGHT_SHOULDER);
  const hip = vis(POSE_LANDMARK.LEFT_HIP) || vis(POSE_LANDMARK.RIGHT_HIP);
  const extent = Math.max(torsoLength(landmarks), shoulderWidth(landmarks), hipWidth(landmarks));
  return { ok: shoulder && hip && extent >= MIN_BODY_SCALE, scale: computeBodyScale(landmarks) };
}
