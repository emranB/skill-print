import { HEAVY_REPRESENTATION, FEATURE_DIMENSION, rawFeatureDistance, usableHeavy } from "../../shared/movement/HeavyBody";
import { featureDistance, oas, projectFeature, quantile, transform, type Feature, type TeacherCalibration3D } from "../../shared/movement/OAS";
import type { CanonicalMovement, Demonstration, MovementKind, MovementReference, NormalizedPose } from "../pose/pose.types";

function arc(path: NormalizedPose[]): number[] {
  const result=[0];
  for(let i=1;i<path.length;i++) result.push(result[i-1]!+rawFeatureDistance(path[i-1]!.body3d!,path[i]!.body3d!));
  return result;
}

/** The only calibration entrypoint accepts reviewed teacher demonstrations, not learner frames. */
export function fitTeacherCalibration(sources: Demonstration[]): TeacherCalibration3D {
  if(!sources.length || sources.some(s => !s.teacherConfirmed || s.classification!=="good")) throw new Error("OAS requires confirmed teacher sources");
  const paths=sources.map(s => s.trajectory.filter(p => usableHeavy(p.body3d)));
  if(paths.some(p => p.length<3)) throw new Error("Insufficient reliable teacher observations");
  const arcs=paths.map(arc).map(a => a.map(v => v/Math.max(a.at(-1)!,1e-9)));
  const weights=Array.from({length:FEATURE_DIMENSION},(_,i) => Math.max(.2,
    paths.reduce((sum,p) => sum+p.reduce((s,v) => s+v.body3d!.featureConfidence[i]!,0)/p.length,0)/paths.length));
  const residuals: number[][]=[];
  paths.forEach((path,i) => path.forEach((pose,k) => {
    const peers=paths.flatMap((other,j) => j===i ? [] : other.filter((_,m) => Math.abs(arcs[j]![m]!-arcs[i]![k]!)<=.1));
    const nearest=peers.length ? peers.reduce((a,b) => rawFeatureDistance(pose.body3d!,a.body3d!)<=rawFeatureDistance(pose.body3d!,b.body3d!) ? a : b)
      : path[Math.max(0,k-1)]!;
    residuals.push(pose.body3d!.features.map((v,j) => v == null || nearest.body3d!.features[j] == null ? 0
      : (v-nearest.body3d!.features[j]!)*Math.sqrt(weights[j]!)));
  }));
  const cal: TeacherCalibration3D={method:"teacher-oas-cholesky-v1",dimension:48,teacherIds:sources.map(s => s.id),sampleCount:residuals.length,
    weights,...oas(residuals),tolerance:0,noise:0,fallback:paths.length===1 ? "single teacher: adjacent-observation noise; cross-demonstration variation unavailable" : null};
  const transformed=paths.map(p => p.map(v => transform(v.body3d!,cal)));
  cal.noise=quantile(transformed.flatMap(p => p.slice(1).map((v,i) => featureDistance(v,p[i]!))),.5);
  const errors=transformed.map((path,i) => quantile(path.map((v,k) => {
    const peers=transformed.flatMap((p,j) => j===i ? [] : p.filter((_,m) => Math.abs(arcs[j]![m]!-arcs[i]![k]!)<=.1));
    return peers.length ? Math.min(...peers.map(p => featureDistance(v,p))) : featureDistance(v,path[Math.max(0,k-1)]!);
  }),.95));
  // Balanced per-source evidence: a long take does not dominate the acceptance radius.
  cal.tolerance=Math.max(quantile(errors,.5),cal.noise*2,1e-4);
  return cal;
}

function simplify(features: Feature[],epsilon: number): number[] {
  const keep=new Set([0,features.length-1]);
  const stack:[[number,number]] | Array<[number,number]>=[[0,features.length-1]];
  while(stack.length) {
    const [a,b]=stack.pop()!;
    let maximum=epsilon,index=-1;
    for(let i=a+1;i<b;i++) {
      const d=projectFeature(features[i]!,features[a]!,features[b]!).distance;
      if(d>maximum) {maximum=d;index=i;}
    }
    if(index>=0) {keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b) => a-b);
}

export function buildHeavyReference(demo: Demonstration,kind: MovementKind,cal: TeacherCalibration3D): MovementReference {
  if(demo.trajectory.some(p => p.body3d?.representation!==HEAVY_REPRESENTATION || p.bodySkeleton)) throw new Error("Incompatible geometry in Heavy reference");
  const source=demo.trajectory;
  const indices=source.map((p,i) => usableHeavy(p.body3d) ? i : -1).filter(i => i>=0);
  const path=indices.map(i => source[i]!);
  const reasons:string[]=[];
  const maximumGapMs=path.slice(1).reduce((m,p,i) => Math.max(m,p.timestampMs-path[i]!.timestampMs),0);
  if(path.length<3) reasons.push("Insufficient reliable observations");
  if(maximumGapMs>1000) reasons.push("Tracking gap exceeds 1000 ms; trim or re-record");
  if(path.some((p,i) => i>0 && p.timestampMs<=path[i-1]!.timestampMs)) reasons.push("Non-monotonic teacher timestamps");
  const features=path.map(p => transform(p.body3d!,cal));
  const maximumNeighborError=Math.max(0,...features.slice(1,-1).map((v,i) => projectFeature(v,features[i]!,features[i+2]!).distance));
  if(maximumNeighborError>cal.tolerance) reasons.push("Isolated source geometry exceeds calibrated neighbor-transition support; review/trim or re-record");
  const noise=quantile(features.slice(1).map((p,i) => featureDistance(p,features[i]!)),.5);
  const excursion=features.length ? Math.max(...features.map(v => featureDistance(features[0]!,v))) : 0;
  if(!Number.isFinite(excursion) || excursion<=Math.max(2*noise,1e-4)) reasons.push("No reliable excursion beyond observation noise");
  // Sub-tolerance detours are observationally indistinguishable, not mandatory stages.
  // RDP retains actual source bodies and bounds every removed point's geometric error.
  const selected=features.length>=3 ? simplify(features,Math.max(cal.tolerance,noise,1e-6)) : [];
  if(selected.length===2) selected.splice(1,0,Math.floor(features.length/2));
  const cumulative=[0];
  for(let i=1;i<selected.length;i++) cumulative.push(cumulative[i-1]!+featureDistance(features[selected[i-1]!]!,features[selected[i]!]!));
  const arcLength=cumulative.at(-1) ?? 0;
  // A teacher-authored cycle can finish in a different body state (e.g. a throw).
  // The observed terminal defines completion; the next cycle still must reacquire its start.
  const terminalStartDistance=features.length ? featureDistance(features[0]!,features.at(-1)!) : 0;
  if(selected.length<3) reasons.push("Trajectory is indistinguishable from a single transition; review or re-record");
  const trajectoryEvidence={construction:"observed-trajectory-v1" as const,representation:HEAVY_REPRESENTATION,
    sourceIndices:selected.map(i => indices[i]!),arcLength,excursion,noise,maximumGapMs,terminalStartDistance,kind,maximumNeighborError,startSourceIndex:indices[0] ?? 0,
    terminalSourceIndex:indices.at(-1) ?? 0,rejectionReasons:reasons};
  const samples=reasons.length ? [] : selected.map((i,k) => ({progress01:cumulative[k]!/Math.max(arcLength,1e-9),phase:"sequence" as const,pose:path[i]!}));
  const anchors=samples.length ? [{...samples[0]!,id:"start" as const,holdMs:0},{...samples.at(-1)!,id:"completion" as const,holdMs:0}] : [];
  return {demonstrationId:demo.id,teacherConfirmed:demo.teacherConfirmed,alignmentEligible:!reasons.length,
    rejectionReason:reasons.length ? reasons.join("; ") : undefined,sourceTrajectory:source,samples,anchors,trajectoryEvidence};
}

export function buildHeavyMovement(demonstrations: Demonstration[],kind: MovementKind,draft=false): CanonicalMovement {
  const confirmed=demonstrations.filter(d => d.teacherConfirmed && d.classification==="good");
  const sources=confirmed.length ? confirmed : draft ? demonstrations.filter(d => d.classification==="unknown").map(d => ({...d,teacherConfirmed:true,classification:"good" as const})) : [];
  if(!sources.length) throw new Error("Confirm at least one coherent teacher demonstration");
  const statisticalCalibration=fitTeacherCalibration(sources);
  const references=sources.map(s => buildHeavyReference(s,kind,statisticalCalibration));
  const preview=references.find(r => r.alignmentEligible);
  if(!preview) throw new Error(`No coherent Heavy reference: ${references.map(r => r.rejectionReason).join("; ")}`);
  const checkpoints=[0,.25,.5,.75,1].map((p,index) => ({index,progress:(p*100) as 0|25|50|75|100,phase:"sequence" as const,
    pose:preview.samples.reduce((a,b) => Math.abs(a.progress01-p)<=Math.abs(b.progress01-p) ? a : b).pose}));
  return {schemaVersion:3,representation:HEAVY_REPRESENTATION,kind,statisticalCalibration,references,
    samples:preview.samples,anchors:preview.anchors,checkpoints,trajectorySource:"coherent_3d_references"};
}
