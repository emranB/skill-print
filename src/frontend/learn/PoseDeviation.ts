import { JOINT_NAMES, MAJOR_JOINTS } from "../pose/PoseUsability";
import type { NormalizedPoseGeometry } from "../pose/pose.types";
import { BODY_EDGES, BODY_JOINTS, usableHeavy } from "../../shared/movement/HeavyBody";
import { articulatedDistance, BEND_JOINTS, BEND_NAMES, BONE_NAMES, usableArticulated } from "../../shared/movement/ArticulatedBody";

/** Below this planar distance (in body-scale units) a joint is close enough not to mention. */
const MIN_DEVIATION = 0.15;

export interface PoseDeviation {
  joint: number;
  name: string;
  /** Which way the student's joint must move to reach the teacher's. */
  direction: "higher" | "lower" | "in" | "out" | "forward" | "back" | "left" | "right" | "bend" | "straighten";
  distance: number;
  angularDegrees?:number;
  boneName?:string;
}

/**
 * The visible major joint farthest from the teacher's checkpoint, in the
 * hip-centred, body-scaled plane both poses share. Image y grows downward,
 * so a larger student y means the joint must move higher.
 */
export function largestDeviation(
  student: NormalizedPoseGeometry,
  target: NormalizedPoseGeometry,
  floor: number,
): PoseDeviation | null {
  let best: PoseDeviation | null = null;
  if(student.articulated3d || target.articulated3d) {
    if(!usableArticulated(student.articulated3d)||!usableArticulated(target.articulated3d)) return null;
    const error=articulatedDistance(student.articulated3d,target.articulated3d);
    error.bones.forEach((value,i) => {
      if(value===null || value<MIN_DEVIATION || best&&value<=best.distance) return;
      const joint=[11,13,15,25,27,14,16,26,28,12,24][i]!;
      const delta=target.articulated3d!.bones[i]!.map((v,k) => v-student.articulated3d!.bones[i]![k]!);
      const axis=delta.reduce((a,_,k) => Math.abs(delta[k]!)>Math.abs(delta[a]!) ? k : a,0);
      best={joint,name:JOINT_NAMES[joint]!,boneName:BONE_NAMES[i],distance:value,angularDegrees:value*180,
        direction:axis===0 ? delta[0]!>0 ? "right":"left" : axis===1 ? delta[1]!>0 ? "higher":"lower" : delta[2]!>0 ? "forward":"back"};
    });
    error.bends.forEach((value,i) => {
      if(value===null || value<MIN_DEVIATION || best&&value<=best.distance) return;
      best={joint:BEND_JOINTS[i]!,name:BEND_NAMES[i]!,distance:value,angularDegrees:value*180,
        direction:target.articulated3d!.bends[i]!>student.articulated3d!.bends[i]! ? "straighten":"bend"};
    });
    return best;
  }
  if (student.body3d || target.body3d) {
    if (!usableHeavy(student.body3d) || !usableHeavy(target.body3d)) return null;
    student.body3d.features.forEach((value,i) => {
      const desired=target.body3d!.features[i];
      if(value==null || desired==null || Math.min(student.body3d!.featureConfidence[i]!,target.body3d!.featureConfidence[i]!)<.5) return;
      const delta=desired-value,distance=Math.abs(delta);
      if(distance<MIN_DEVIATION || best && distance<=best.distance) return;
      const bone=Math.floor(i/4),component=i%4,joint=BODY_JOINTS[BODY_EDGES[bone]![1]!]!;
      best={joint,name:JOINT_NAMES[joint]!,distance,direction:component===3 ? delta>0 ? "straighten" : "bend"
        : component===0 ? delta>0 ? "right" : "left" : component===1 ? delta>0 ? "lower" : "higher" : delta>0 ? "forward" : "back"};
    });
    return best;
  }
  if (student.bodySkeleton && target.bodySkeleton) {
    for (let i = 0; i < MAJOR_JOINTS.length; i++) {
      const s = student.bodySkeleton.joints[i]!;
      const t = target.bodySkeleton.joints[i]!;
      if (!student.bodySkeleton.orientationReliable || !target.bodySkeleton.orientationReliable || Math.min(student.bodySkeleton.confidence[i]!, target.bodySkeleton.confidence[i]!) < 0.5) continue;
      const delta = s.map((v, j) => v - t[j]!);
      const distance = Math.hypot(...delta);
      if (distance < MIN_DEVIATION || (best && distance <= best.distance)) continue;
      const axis = delta.reduce((a, _, j) => Math.abs(delta[j]!) > Math.abs(delta[a]!) ? j : a, 0);
      best = { joint: MAJOR_JOINTS[i]!, name: JOINT_NAMES[MAJOR_JOINTS[i]!]!, distance,
        direction: axis === 1 ? delta[1]! > 0 ? "higher" : "lower" : axis === 2 ? delta[2]! > 0 ? "back" : "forward" : Math.abs(s[0]) > Math.abs(t[0]) ? "in" : "out" };
    }
    return best;
  }
  for (const joint of MAJOR_JOINTS) {
    const s = student.landmarks[joint];
    const t = target.landmarks[joint];
    if (!s || !t || (s.visibility ?? 0) < floor || (t.visibility ?? 1) < floor) continue;
    const dx = Math.abs(s.x) - Math.abs(t.x);
    const dy = s.y - t.y;
    const distance = Math.hypot(s.x - t.x, dy);
    if (distance < MIN_DEVIATION || (best && distance <= best.distance)) continue;
    const vertical = Math.abs(dy) >= Math.abs(dx);
    best = {
      joint,
      name: JOINT_NAMES[joint] ?? `joint ${joint}`,
      direction: vertical ? (dy > 0 ? "higher" : "lower") : dx > 0 ? "in" : "out",
      distance,
    };
  }
  return best;
}

export function describeDeviation(deviation: PoseDeviation): string {
  if(deviation.angularDegrees!==undefined) return deviation.boneName
    ? `Reposition your ${deviation.boneName} toward the teacher's direction (${Math.round(deviation.angularDegrees)} degrees difference).`
    : `${deviation.direction==="bend" ? "Bend":"Straighten"} your ${deviation.name} (${Math.round(deviation.angularDegrees)} degrees difference).`;
  switch (deviation.direction) {
    case "left": return `Move your ${deviation.name} left relative to your body.`;
    case "right": return `Move your ${deviation.name} right relative to your body.`;
    case "bend": return `Bend your ${deviation.name} relative to the connected limb.`;
    case "straighten": return `Straighten your ${deviation.name} relative to the connected limb.`;
    case "forward": return `Move your ${deviation.name} forward relative to your body.`;
    case "back": return `Move your ${deviation.name} back relative to your body.`;
    case "higher":
      return `Bring your ${deviation.name} higher.`;
    case "lower":
      return `Bring your ${deviation.name} lower.`;
    case "in":
      return `Bring your ${deviation.name} in closer to your body.`;
    case "out":
      return `Move your ${deviation.name} further out.`;
  }
}
