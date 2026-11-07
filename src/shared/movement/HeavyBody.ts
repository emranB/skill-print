import type { Vector3 } from "./types";

export const HEAVY_REPRESENTATION = "mediapipe-heavy-body3d-v1" as const;
export const HEAVY_MODEL = "/models/pose_landmarker_heavy.task";
export const HEAVY_HASH = "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b";
export const BODY_JOINTS = [11,12,13,14,15,16,23,24,25,26,27,28];
export const BODY_EDGES = [[6,0],[7,1],[0,2],[2,4],[1,3],[3,5],[6,8],[8,10],[7,9],[9,11],[0,1],[6,7]];
export const BONE_PARENTS = [10,10,0,2,1,4,11,6,11,8,11,10];
export const FEATURE_DIMENSION = 48;

export interface HeavyBody {
  representation: typeof HEAVY_REPRESENTATION;
  modelHash: string;
  joints: Array<Vector3 | null>;
  bones: Array<Vector3 | null>;
  confidence: number[];
  boneConfidence: number[];
  features: Array<number | null>;
  featureConfidence: number[];
  root: Vector3;
  scale: number;
  basis: Vector3[];
  orientationReliable: boolean;
}

type Point = { x: number; y: number; z: number; visibility?: number };
export const dot = (a: number[], b: number[]) => a.reduce((s,x,i) => s+x*b[i]!,0);
export const subtract = (a: number[], b: number[]) => a.map((x,i) => x-b[i]!);
export const norm = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]): Vector3 => a.map(x => x/Math.max(norm(a),1e-12)) as Vector3;
const cross = (a: number[], b: number[]): Vector3 => [a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!];

/** Anatomical lateral axis + camera gravity: yaw normalization, never L/R swapping. */
export function heavyBody(world: Point[], image: Point[] = world): HeavyBody | undefined {
  const observed = BODY_JOINTS.map(i => world[i]);
  const confidence = observed.map((p,j) => p && [p.x,p.y,p.z].every(Number.isFinite)
    ? Math.max(0,Math.min(1,Math.min(p.visibility ?? 0,image[BODY_JOINTS[j]!] ?.visibility ?? 0))) : 0);
  const raw = observed.map((p,i): Vector3 | null => p && confidence[i]! > 0 ? [p.x,p.y,p.z] : null);
  const [ls,rs,,,,,lh,rh] = raw;
  if (!lh || !rh) return undefined;
  const root = lh.map((x,i) => (x+rh[i]!)/2) as Vector3;
  const shoulder = ls && rs ? subtract(rs,ls) : null;
  const hip = subtract(rh,lh);
  const lateral = shoulder ? shoulder.map((x,i) => x+hip[i]!) : hip;
  lateral[1] = 0;
  const orientationReliable = norm(lateral) > .025 && confidence[6]! >= .3 && confidence[7]! >= .3 &&
    Boolean(ls && rs && confidence[0]! >= .3 && confidence[1]! >= .3);
  const right = unit(lateral);
  const down: Vector3 = [0,1,0];
  const forward = unit(cross(right,down));
  const basis = [right,down,forward];
  const shoulderMid = ls && rs ? ls.map((x,i) => (x+rs[i]!)/2) : root;
  const scale = Math.max(norm(subtract(shoulderMid,root)),norm(hip)*1.8,1e-6);
  const joints = raw.map(p => p ? basis.map(axis => dot(subtract(p,root),axis)/scale) as Vector3 : null);
  const bones = BODY_EDGES.map(([a,b]) => joints[a!] && joints[b!]
    ? unit(subtract(joints[b!]!,joints[a!]!)) : null);
  const boneConfidence = BODY_EDGES.map(([a,b],i) => bones[i] ? Math.min(confidence[a!]!,confidence[b!]!) : 0);
  const features: Array<number | null> = [];
  const featureConfidence: number[] = [];
  bones.forEach((bone,i) => {
    const parent = bones[BONE_PARENTS[i]!]!;
    features.push(...(bone ?? [null,null,null]),bone && parent ? dot(bone,parent) : null);
    featureConfidence.push(...Array<number>(3).fill(orientationReliable ? boneConfidence[i]! : 0),
      orientationReliable && bone && parent ? Math.min(boneConfidence[i]!,boneConfidence[BONE_PARENTS[i]!]!) : 0);
  });
  return { representation: HEAVY_REPRESENTATION,modelHash: HEAVY_HASH,joints,bones,confidence,boneConfidence,
    features,featureConfidence,root,scale,basis,orientationReliable };
}

export function usableHeavy(body?: HeavyBody): body is HeavyBody {
  return Boolean(body?.orientationReliable && body.boneConfidence.filter(c => c >= .3).length >= 6);
}

export function rawFeatureDistance(a: HeavyBody,b: HeavyBody): number {
  let sum=0,weight=0;
  a.features.forEach((v,i) => {
    const u=b.features[i];
    if (v === null || u == null) return;
    const w=Math.min(a.featureConfidence[i]!,b.featureConfidence[i]!)**2;
    sum+=w*(v-u)**2; weight+=w;
  });
  return weight >= 1 ? Math.sqrt(sum/weight) : Infinity;
}
