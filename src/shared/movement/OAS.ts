import { FEATURE_DIMENSION, type HeavyBody } from "./HeavyBody";

export interface TeacherCalibration3D {
  method: "teacher-oas-cholesky-v1";
  dimension: 48;
  teacherIds: string[];
  sampleCount: number;
  shrinkage: number;
  weights: number[];
  covariance: number[][];
  whitening: number[][];
  tolerance: number;
  noise: number;
  fallback: string | null;
}
export interface Feature { values: number[]; confidence: number[] }
export const quantile = (values: number[],q: number) => {
  const sorted=values.filter(Number.isFinite).sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor(q*(sorted.length-1))))] ?? 0;
};

/** OAS (Chen et al., sklearn variant); inverse Cholesky is a valid whitening factor. */
export function oas(residuals: number[][]): Pick<TeacherCalibration3D,"covariance"|"whitening"|"shrinkage"> {
  const d=FEATURE_DIMENSION,n=Math.max(1,residuals.length);
  const empirical=Array.from({length:d},(_,i) => Array.from({length:d},(_,j) =>
    residuals.reduce((s,r) => s+r[i]!*r[j]!,0)/n));
  const trace=empirical.reduce((s,r,i) => s+r[i]!,0);
  const frobenius=empirical.reduce((s,r) => s+r.reduce((t,x) => t+x*x,0),0);
  const denominator=(n+1)*(frobenius-trace*trace/d);
  const shrinkage=denominator>0 ? Math.min(1,(frobenius+trace*trace)/denominator) : 1;
  const variance=Math.max(trace/d,1e-8);
  const covariance=empirical.map((r,i) => r.map((x,j) => (1-shrinkage)*x+(i===j ? shrinkage*variance+variance*1e-6 : 0)));
  const lower=Array.from({length:d},() => Array<number>(d).fill(0));
  for(let i=0;i<d;i++) for(let j=0;j<=i;j++) {
    let v=covariance[i]![j]!;
    for(let k=0;k<j;k++) v-=lower[i]![k]!*lower[j]![k]!;
    lower[i]![j]=i===j ? Math.sqrt(Math.max(v,variance*1e-9)) : v/lower[j]![j]!;
  }
  const whitening=Array.from({length:d},() => Array<number>(d).fill(0));
  for(let j=0;j<d;j++) for(let i=j;i<d;i++) {
    let v=i===j ? 1 : 0;
    for(let k=j;k<i;k++) v-=lower[i]![k]!*whitening[k]![j]!;
    whitening[i]![j]=v/lower[i]![i]!;
  }
  const magnitude=Math.sqrt(whitening.reduce((s,r) => s+r.reduce((t,x) => t+x*x,0),0)/d);
  return { covariance,whitening: whitening.map(r => r.map(x => x/magnitude)),shrinkage };
}

/** Missing inputs mask affected whitened components, never supply invented zero poses. */
export function transform(body: HeavyBody,cal: TeacherCalibration3D): Feature {
  const values: number[]=[],confidence: number[]=[];
  cal.whitening.forEach(row => {
    let v=0,power=0,uncertainty=0,missing=0;
    row.forEach((w,j) => {
      w*=Math.sqrt(cal.weights[j]!);
      power+=w*w;
      const c=body.featureConfidence[j]!;
      if(body.features[j] == null || c<.15) { missing+=w*w; return; }
      v+=w*body.features[j]!;
      uncertainty+=w*w/(c*c);
    });
    values.push(v);
    confidence.push(missing>power*.01 ? 0 : Math.sqrt(power/Math.max(uncertainty,1e-12)));
  });
  return {values,confidence};
}

export function featureDistance(a: Feature,b: Feature): number {
  let sum=0,weight=0;
  for(let i=0;i<a.values.length;i++) {
    const w=Math.min(a.confidence[i]!,b.confidence[i]!)**2;
    sum+=w*(a.values[i]!-b.values[i]!)**2; weight+=w;
  }
  return weight>=1 ? Math.sqrt(sum/weight) : Infinity;
}

export function interpolateFeature(a: Feature,b: Feature,t: number): Feature {
  return {values: a.values.map((v,i) => v+t*(b.values[i]!-v)),confidence:a.confidence.map((c,i) => Math.min(c,b.confidence[i]!))};
}

export function projectFeature(v: Feature,a: Feature,b: Feature): {fraction:number;distance:number} {
  let numerator=0,denominator=0;
  a.values.forEach((x,i) => {
    const w=Math.min(a.confidence[i]!,b.confidence[i]!,v.confidence[i]!)**2;
    const delta=b.values[i]!-x;
    numerator+=w*(v.values[i]!-x)*delta; denominator+=w*delta*delta;
  });
  const fraction=Math.max(0,Math.min(1,numerator/Math.max(denominator,1e-12)));
  return {fraction,distance:featureDistance(v,interpolateFeature(a,b,fraction))};
}
