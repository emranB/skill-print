import { hipMidpoint } from "../pose/PoseGeometry";
import { computeBodyScale, scaleNormalizedToStudent } from "../pose/PoseNormalizer";
import { bodyScaleEvidence, usabilityFloor } from "../pose/PoseUsability";
import type { CanonicalSample, Landmark } from "../pose/pose.types";
import type { BodySkeleton } from "../../shared/movement/types";
import { MAJOR_JOINTS } from "../pose/PoseUsability";
import type { HeavyBody } from "../../shared/movement/HeavyBody";
import type { ArticulatedBody } from "../../shared/movement/ArticulatedBody";

/** Where the ghost stands when no student is in view: centre stage at a typical body size. */
const STAGE = { origin: { x: 0.5, y: 0.55, z: 0 }, scale: 0.22 };

/**
 * Place a learned checkpoint in the student's image space so teacher and
 * student skeletons overlay: hip-centred on the student, at the student's scale.
 */
export function ghostLandmarks(
  checkpoint: Pick<CanonicalSample, "pose"> | undefined,
  student: Landmark[] | null,
  minimumVisibility: number,
  body?: BodySkeleton | HeavyBody | ArticulatedBody,
): Landmark[] | null {
  if (!checkpoint) return null;
  const teacher=checkpoint.pose.articulated3d??checkpoint.pose.body3d;
  if (teacher && body?.representation === teacher.representation && body.orientationReliable && student) {
    const origin=hipMidpoint(student) ?? STAGE.origin;
    const scale=computeBodyScale(student);
    const landmarks=Array.from({length:33},():Landmark => ({x:0,y:0,z:0,visibility:0}));
    teacher.joints.forEach((joint,i) => {
      if (!joint || Math.min(teacher.confidence[i]!,body.confidence[i]!)<.3) return;
      const camera=body.basis[0]!.map((_,axis) => joint.reduce((sum,v,j) => sum+v*body.basis[j]![axis]!,0));
      landmarks[MAJOR_JOINTS[i]!] = {x:origin.x+camera[0]!*scale,y:origin.y+camera[1]!*scale,
        z:(origin.z ?? 0)+camera[2]!*scale,visibility:Math.min(teacher.confidence[i]!,body.confidence[i]!)};
    });
    return landmarks;
  }
  if (checkpoint.pose.bodySkeleton && body?.representation === "rtmw3d-body-v1" && body.orientationReliable && body.imageSize) {
    const teacher = checkpoint.pose.bodySkeleton;
    const [width, height] = body.imageSize;
    const landmarks = Array.from({ length: 33 }, (): Landmark => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    teacher.joints.forEach((joint, i) => {
      const camera = body.root.map((root, axis) => root + joint.reduce((sum, value, j) => sum + value * body.basis[j]![axis]! * body.scale, 0));
      if (camera[2]! <= 0) return;
      landmarks[MAJOR_JOINTS[i]!] = { x: (camera[0]! / camera[2]! * 1145.04940459 + width / 2) / width,
        y: (camera[1]! / camera[2]! * 1143.78109572 + height / 2) / height, z: camera[2]! - body.root[2], visibility: teacher.confidence[i] };
    });
    return landmarks;
  }
  const anchored = student && bodyScaleEvidence(student, usabilityFloor(minimumVisibility)).ok;
  const origin = (anchored && hipMidpoint(student)) || STAGE.origin;
  const scale = anchored ? computeBodyScale(student) : STAGE.scale;
  return scaleNormalizedToStudent(checkpoint.pose, scale, { x: origin.x, y: origin.y, z: origin.z ?? 0 });
}
