import { heavyBody, rawFeatureDistance, usableHeavy } from "../../shared/movement/HeavyBody";
import { quantile } from "../../shared/movement/OAS";
import { createId } from "../../shared/utils/id";
import { normalizePose } from "../pose/PoseNormalizer";
import type { Demonstration, PoseFrame } from "../pose/pose.types";
import type { SegmentationSummary } from "./analyze.types";

export function heavySequence(frames:PoseFrame[]):Demonstration[] {
  const path=frames.filter(f => usableHeavy(f.body3d)).map(normalizePose);
  if(path.length<3) return [];
  return [{id:createId(),kind:"sequence",startMs:path[0]!.timestampMs,endMs:path.at(-1)!.timestampMs,
    trajectory:path,classification:"unknown",teacherConfirmed:false}];
}

/** Section-23 recurrence/PCA hysteresis. Only the scalar signal is smoothed; poses remain observed. */
export function heavyCycles(frames:PoseFrame[]):{demonstrations:Demonstration[];diagnostics:SegmentationSummary} {
  const usable=frames.filter(f => usableHeavy(f.body3d));
  const diagnostics:SegmentationSummary={usableFrames:usable.length,skippedLowVisibility:frames.length-usable.length,
    restSource:"stable_dwell",restDwellMs:0,regimes:[],completeCycles:0,fragmentCycles:0};
  if(usable.length<3) return {demonstrations:[],diagnostics};
  const times=usable.map(f => f.timestampMs),bodies=usable.map(f => f.body3d!);
  // A stable recurrence signal uses inclination + flexion, NOT the scored descriptor.
  // Directional XYZ remains intact in every source pose, calibration and live comparison.
  const signal=bodies.map(b => Array.from({length:12},(_,bone) => [b.features[bone*4+1],b.features[bone*4+3]]).flat());
  const means=Array.from({length:24},(_,j) => {
    const values=signal.map(b => b[j]).filter((v):v is number => v!==null && v!==undefined);
    return values.reduce((s,v) => s+v,0)/Math.max(1,values.length);
  });
  const rows=signal.map(b => b.map((v,j) => v ?? means[j]!));
  const variance=means.map((m,j) => rows.reduce((s,r) => s+(r[j]!-m)**2,0)/rows.length);
  const boneNoise=Array.from({length:12},(_,bone) => quantile(rows.map((r,i) => {
    const next=times.findIndex(t => t>=times[i]!+200),other=rows[next<0 ? rows.length-1 : next]!;
    return (other[bone*2]!-r[bone*2]!)**2+(other[bone*2+1]!-r[bone*2+1]!)**2;
  }),.5));
  const strength=boneNoise.map((n,i) => (variance[i*2]!+variance[i*2+1]!)/Math.max(n,quantile(boneNoise,.5)*.1,1e-9));
  const maximum=Math.max(...strength,1e-9);
  const weights=strength.flatMap(v => [Math.max(.2,v/maximum),Math.max(.2,v/maximum)]);
  const centered=rows.map(r => r.map((v,j) => (v-means[j]!)*Math.sqrt(weights[j]!)));
  let axis=Array<number>(24).fill(1/Math.sqrt(24));
  for(let iteration=0;iteration<40;iteration++) {
    const next=Array<number>(24).fill(0);
    centered.forEach(r => { const projection=r.reduce((s,v,j) => s+v*axis[j]!,0);r.forEach((v,j) => {next[j]!+=projection*v;}); });
    const length=Math.hypot(...next);
    if(length<1e-12) break;
    axis=next.map(v => v/length);
  }
  const coordinate=centered.map(r => r.reduce((s,v,j) => s+v*axis[j]!,0));
  const pairs=coordinate.flatMap((a,i) => coordinate.slice(i+1).map(b => Math.abs(a-b)));
  const radius=quantile(pairs,.1);
  const cadence=quantile(times.slice(1).map((t,i) => t-times[i]!),.5);
  const density=coordinate.map(a => coordinate.reduce((s,b,j) => s+(Math.abs(a-b)<=radius ? Math.min(times[j+1] ? times[j+1]!-times[j]! : cadence,cadence*3) : 0),0));
  const rest=density.indexOf(Math.max(...density));
  const excursion=coordinate.map(v => Math.abs(v-coordinate[rest]!));
  const smooth=times.map(t => quantile(excursion.filter((_,j) => Math.abs(times[j]!-t)<=150),.5));
  const baseline=quantile(smooth,.2),amplitude=quantile(smooth,.95)-baseline;
  const enter=baseline+.2*amplitude,leave=baseline+.1*amplitude;
  const minimumExcursion=Math.max(2*quantile(smooth.slice(1).map((v,i) => Math.abs(v-smooth[i]!)),.9),amplitude*.2);
  diagnostics.regimes=[{startMs:times[0]!,endMs:times.at(-1)!,enterThreshold:enter,exitThreshold:leave}];
  diagnostics.restDwellMs=density[rest]!;
  const demonstrations:Demonstration[]=[];
  let start:number | null=null,peak=0,lastRest=0;
  const emit=(end:number,fragment:boolean) => {
    if(start===null || end<=start || peak-baseline<minimumExcursion) return;
    const path=usable.slice(start,end+1).map(normalizePose);
    const gap=path.slice(1).some((p,i) => p.timestampMs-path[i]!.timestampMs>1000);
    // Returning to the latent rest alone is not sufficient if the full body moved to a different state.
    const span=Math.max(...path.map(p => rawFeatureDistance(path[0]!.body3d!,p.body3d!)));
    const disconnected=rawFeatureDistance(path[0]!.body3d!,path.at(-1)!.body3d!)>span*.6;
    const rejected=fragment || gap || disconnected;
    demonstrations.push({id:createId(),kind:"cycle",startMs:path[0]!.timestampMs,endMs:path.at(-1)!.timestampMs,
      classification:rejected ? "fragment" : "unknown",teacherConfirmed:false,trajectory:path});
    if(rejected) diagnostics.fragmentCycles++; else diagnostics.completeCycles++;
  };
  smooth.forEach((value,i) => {
    if(i>0 && times[i]!-times[i-1]!>1000) {emit(i-1,true);start=null;lastRest=i;}
    if(start===null) {
      if(value>enter) {start=lastRest;peak=value;}
      else if(value<=leave) lastRest=i;
    } else {
      peak=Math.max(peak,value);
      if(value<=leave) {emit(i,start===0 && smooth[0]!>leave);start=null;lastRest=i;}
    }
  });
  emit(usable.length-1,true);
  diagnostics.genericEvidence={algorithm:"recurrence-pca-hysteresis-v1",restMs:times[rest]!,radius,baseline,amplitude,weights,
    proposals:demonstrations.map(d => ({id:d.id,startMs:d.startMs,endMs:d.endMs,classification:d.classification,
      reason:d.classification==="fragment" ? "open, disconnected or tracking-gap episode; review/trim required" : "coherent recurrence proposal; teacher review required"}))};
  return {demonstrations,diagnostics};
}

/** Explicit conversion for historical raw MediaPipe diagnostic recordings, never RTMW geometry. */
export function attachHeavyGeometry(frame:PoseFrame):PoseFrame {
  return {...frame,body3d:heavyBody(frame.worldLandmarks,frame.landmarks)};
}
