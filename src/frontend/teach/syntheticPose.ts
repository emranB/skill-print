import type { PoseFrame } from "../pose/pose.types";
import { normalizePose } from "../pose/PoseNormalizer";

/** Minimal upright pose for placeholder reference when live camera pose is unavailable. */
export function syntheticReferenceFrame(timestampMs = 0): PoseFrame {
  const mk = (x: number, y: number) => ({ x, y, z: 0, visibility: 0.9 });
  const landmarks = Array.from({ length: 33 }, () => mk(0.5, 0.5));
  landmarks[0] = mk(0.5, 0.15);
  landmarks[11] = mk(0.45, 0.35);
  landmarks[12] = mk(0.55, 0.35);
  landmarks[23] = mk(0.45, 0.55);
  landmarks[24] = mk(0.55, 0.55);
  landmarks[25] = mk(0.45, 0.72);
  landmarks[26] = mk(0.55, 0.72);
  landmarks[27] = mk(0.45, 0.9);
  landmarks[28] = mk(0.55, 0.9);
  return {
    timestampMs,
    landmarks,
    worldLandmarks: landmarks.map((l) => ({ ...l })),
  };
}

export function syntheticReferencePose(timestampMs = 0) {
  return normalizePose(syntheticReferenceFrame(timestampMs));
}
