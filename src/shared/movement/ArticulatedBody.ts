import { BODY_JOINTS, HEAVY_HASH } from "./HeavyBody";
import type { Vector3 } from "./types";

export const ARTICULATED_REPRESENTATION = "mediapipe-articulated-3d-v1" as const;
export const ARTICULATED_TOLERANCE = 0.25;
export const ARTICULATED_CONFIDENCE = 0.3;
export const MIN_COMMON_BONES = 6;
export const BONE_NAMES = [
  "torso",
  "left upper arm",
  "left forearm",
  "left thigh",
  "left shin",
  "right upper arm",
  "right forearm",
  "right thigh",
  "right shin",
  "shoulder span",
  "hip span",
];
export const BEND_NAMES = [
  "left elbow",
  "right elbow",
  "left shoulder",
  "right shoulder",
  "left hip",
  "right hip",
  "left knee",
  "right knee",
];
export const BEND_JOINTS = [13, 14, 11, 12, 23, 24, 25, 26];
const EDGES = [
  [0, 2],
  [2, 4],
  [6, 8],
  [8, 10],
  [1, 3],
  [3, 5],
  [7, 9],
  [9, 11],
  [0, 1],
  [6, 7],
];
const BENDS = [
  [1, 2],
  [5, 6],
  [0, 1],
  [0, 5],
  [0, 3],
  [0, 7],
  [3, 4],
  [7, 8],
];
type Point = { x: number; y: number; z: number; visibility?: number };
const sub = (a: number[], b: number[]): Vector3 => a.map((x, i) => x - b[i]!) as Vector3;
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
const unit = (v: number[]): Vector3 | null =>
  Math.hypot(...v) > 1e-8 ? (v.map((x) => x / Math.hypot(...v)) as Vector3) : null;
const cross = (a: number[], b: number[]): Vector3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

export interface ArticulatedBody {
  representation: typeof ARTICULATED_REPRESENTATION;
  modelHash: string;
  joints: Array<Vector3 | null>;
  confidence: number[];
  bones: Array<Vector3 | null>;
  boneConfidence: number[];
  bends: Array<number | null>;
  bendConfidence: number[];
  root: Vector3;
  scale: number;
  basis: Vector3[];
  orientationReliable: boolean;
}

/** Anatomical orthonormal frame, not camera calibration or metric reconstruction. */
export function articulatedBody(
  world: Point[],
  image: Point[] = world,
): ArticulatedBody | undefined {
  const confidence = BODY_JOINTS.map((i) => {
    const p = world[i];
    return p && [p.x, p.y, p.z].every(Number.isFinite)
      ? Math.max(0, Math.min(1, p.visibility ?? 0, image[i]?.visibility ?? 0))
      : 0;
  });
  const raw = BODY_JOINTS.map((i, j): Vector3 | null =>
    confidence[j]! > 0 ? [world[i]!.x, world[i]!.y, world[i]!.z] : null,
  );
  const [ls, rs, , , , , lh, rh] = raw;
  if (!ls || !rs || !lh || !rh) return undefined;
  const root = lh.map((x, i) => (x + rh[i]!) / 2) as Vector3;
  const shoulder = ls.map((x, i) => (x + rs[i]!) / 2) as Vector3;
  const torso = sub(shoulder, root),
    up = unit(torso);
  const lateral = sub(rh, lh).map((v, i) => v + sub(rs, ls)[i]!);
  const forward = up && unit(cross(lateral, up));
  const right = up && forward && unit(cross(up, forward));
  if (!up || !forward || !right) return undefined;
  const basis = [right, up, forward];
  const orientationReliable = [0, 1, 6, 7].every((i) => confidence[i]! >= ARTICULATED_CONFIDENCE);
  const scale = Math.hypot(...torso);
  const joints = raw.map((p) =>
    p ? (basis.map((axis) => dot(sub(p, root), axis) / scale) as Vector3) : null,
  );
  const torsoConfidence = Math.min(...[0, 1, 6, 7].map((i) => confidence[i]!));
  const bones: Array<Vector3 | null> = [
    basis.map((axis) => dot(up, axis)) as Vector3,
    ...EDGES.map(([a, b]) =>
      joints[a!] && joints[b!] ? unit(sub(joints[b!]!, joints[a!]!)) : null,
    ),
  ];
  const boneConfidence = [
    torsoConfidence,
    ...EDGES.map(([a, b], i) => (bones[i + 1] ? Math.min(confidence[a!]!, confidence[b!]!) : 0)),
  ];
  const bends = BENDS.map(([a, b]) =>
    bones[a!] && bones[b!] ? Math.PI - angle(bones[a!]!, bones[b!]!) : null,
  );
  const bendConfidence = BENDS.map(([a, b], i) =>
    bends[i] === null ? 0 : Math.min(boneConfidence[a!]!, boneConfidence[b!]!),
  );
  return {
    representation: ARTICULATED_REPRESENTATION,
    modelHash: HEAVY_HASH,
    joints,
    confidence,
    bones,
    boneConfidence,
    bends,
    bendConfidence,
    root,
    scale,
    basis,
    orientationReliable,
  };
}

export function usableArticulated(body?: ArticulatedBody): body is ArticulatedBody {
  return Boolean(
    body?.orientationReliable &&
    body.boneConfidence.filter((c) => c >= ARTICULATED_CONFIDENCE).length >= MIN_COMMON_BONES,
  );
}

/** Angular errors normalized by pi; fixed 3:1 mean direction/bend weighting. */
export function articulatedDistance(a: ArticulatedBody, b: ArticulatedBody) {
  const bones = a.bones.map((v, i) =>
    v &&
    b.bones[i] &&
    Math.min(a.boneConfidence[i]!, b.boneConfidence[i]!) >= ARTICULATED_CONFIDENCE
      ? angle(v, b.bones[i]!) / Math.PI
      : null,
  );
  const bends = a.bends.map((v, i) =>
    v !== null &&
    b.bends[i] != null &&
    Math.min(a.bendConfidence[i]!, b.bendConfidence[i]!) >= ARTICULATED_CONFIDENCE
      ? Math.abs(v - b.bends[i]!) / Math.PI
      : null,
  );
  const mean = (v: Array<number | null>) => {
    const valid = v.filter((x): x is number => x !== null);
    return valid.length ? valid.reduce((s, x) => s + x, 0) / valid.length : 0;
  };
  const commonBones = bones.filter((v) => v !== null).length;
  const valid = usableArticulated(a) && usableArticulated(b) && commonBones >= MIN_COMMON_BONES;
  const distance = valid ? 0.75 * mean(bones) + 0.25 * mean(bends) : Infinity;
  return {
    distance,
    similarity: valid ? Math.max(0, 1 - distance) : 0,
    commonBones,
    commonBends: bends.filter((v) => v !== null).length,
    bones,
    bends,
    worst: valid
      ? Math.max(0, ...[...bones, ...bends].filter((x): x is number => x !== null))
      : Infinity,
  };
}

export function interpolateArticulated(
  a: ArticulatedBody,
  b: ArticulatedBody,
  t: number,
): ArticulatedBody {
  const bones = a.bones.map((v, i) =>
    v && b.bones[i] ? unit(v.map((x, j) => x + t * (b.bones[i]![j]! - x))) : null,
  );
  return {
    ...a,
    bones,
    boneConfidence: a.boneConfidence.map((c, i) =>
      bones[i] ? Math.min(c, b.boneConfidence[i]!) : 0,
    ),
    bends: a.bends.map((v, i) =>
      v !== null && b.bends[i] != null ? v + t * (b.bends[i]! - v) : null,
    ),
    bendConfidence: a.bendConfidence.map((c, i) => Math.min(c, b.bendConfidence[i]!)),
  };
}
