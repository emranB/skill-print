import type { PoseFrame } from "../pose/pose.types";
import type { BodyCalibration } from "../pose/pose.types";
import { hipWidth, landmarkVisibilityMap, shoulderWidth, torsoLength } from "../pose/PoseGeometry";
import { normalizePose } from "../pose/PoseNormalizer";
import { POSE_LANDMARK } from "../pose/pose.types";

const VIS_INDICES = [
  POSE_LANDMARK.LEFT_SHOULDER,
  POSE_LANDMARK.RIGHT_SHOULDER,
  POSE_LANDMARK.LEFT_HIP,
  POSE_LANDMARK.RIGHT_HIP,
  POSE_LANDMARK.LEFT_KNEE,
  POSE_LANDMARK.RIGHT_KNEE,
  POSE_LANDMARK.LEFT_ANKLE,
  POSE_LANDMARK.RIGHT_ANKLE,
];

export function captureBodyCalibration(frame: PoseFrame): BodyCalibration {
  return {
    capturedAtMs: frame.timestampMs,
    neutralPose: normalizePose(frame),
    shoulderWidth: shoulderWidth(frame.landmarks),
    torsoLength: torsoLength(frame.landmarks),
    hipWidth: hipWidth(frame.landmarks),
    bodyHeightEstimate: torsoLength(frame.landmarks) * 2.2,
    visibility: landmarkVisibilityMap(frame.landmarks, VIS_INDICES),
  };
}
