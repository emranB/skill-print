import { hipMidpoint } from "../pose/PoseGeometry";
import { computeBodyScale, scaleNormalizedToStudent } from "../pose/PoseNormalizer";
import { bodyScaleEvidence, usabilityFloor } from "../pose/PoseUsability";
import type { CanonicalCheckpoint, Landmark } from "../pose/pose.types";

/** Where the ghost stands when no student is in view: centre stage at a typical body size. */
const STAGE = { origin: { x: 0.5, y: 0.55, z: 0 }, scale: 0.22 };

/**
 * Place a learned checkpoint in the student's image space so teacher and
 * student skeletons overlay: hip-centred on the student, at the student's scale.
 */
export function ghostLandmarks(
  checkpoint: CanonicalCheckpoint | undefined,
  student: Landmark[] | null,
  minimumVisibility: number,
): Landmark[] | null {
  if (!checkpoint) return null;
  const anchored = student && bodyScaleEvidence(student, usabilityFloor(minimumVisibility)).ok;
  const origin = (anchored && hipMidpoint(student)) || STAGE.origin;
  const scale = anchored ? computeBodyScale(student) : STAGE.scale;
  return scaleNormalizedToStudent(checkpoint.pose, scale, { x: origin.x, y: origin.y, z: origin.z ?? 0 });
}
