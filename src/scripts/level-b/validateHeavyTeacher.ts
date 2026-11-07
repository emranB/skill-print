import fs from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { HeavyProgressTracker } from "../../frontend/learn/HeavyProgressTracker";
import { transform } from "../../shared/movement/OAS";
import { LessonSchema } from "../../frontend/lesson/LessonSchema";
import type { CanonicalMovement, NormalizedPose } from "../../frontend/pose/pose.types";
import type { Lesson } from "../../frontend/lesson/lesson.types";

const root="test-results/movement/heavy-v1";
function replay(path:NormalizedPose[],canonical:CanonicalMovement,difficulty=75) {
  const tracker=new HeavyProgressTracker(canonical,difficulty);
  let completions=0;const events:Array<Record<string,unknown>>=[];
  for(const pose of path) {
    const event=tracker.update(pose);
    if(event?.type==="REP_SUCCESS" || event?.type==="SEQUENCE_COMPLETE") {completions++;events.push({timestampMs:pose.timestampMs,...tracker.diagnostics()});}
  }
  return {completions,...tracker.diagnostics(),events};
}
const teacher=JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`,"utf8")) as {lesson:Lesson;analysis:unknown;targetCounts:Record<string,number>};
const lesson=teacher.lesson,canonical=lesson.canonicalMovement;
LessonSchema.parse(lesson);
const eligible=canonical.references!.filter(r => r.alignmentEligible);
const single=(id:string) => ({...canonical,references:eligible.filter(r => r.demonstrationId===id),samples:eligible.find(r => r.demonstrationId===id)!.samples,anchors:eligible.find(r => r.demonstrationId===id)!.anchors});
const report={teacherOnly:true,calibration:canonical.statisticalCalibration,targets:teacher.targetCounts,
  quality:canonical.references!.map(r => ({id:r.demonstrationId,eligible:r.alignmentEligible,reason:r.rejectionReason,evidence:r.trajectoryEvidence,samples:r.samples.length})),
  self:Object.fromEntries([20,50,75,80,100].map(d => [d,eligible.map(r => replay(r.sourceTrajectory,single(r.demonstrationId),d))])),
  robustness:eligible.map(r => ({id:r.demonstrationId,
    half:replay(Array.from({length:Math.ceil(r.sourceTrajectory.length/2)},(_,i) => r.sourceTrajectory[Math.round(i*(r.sourceTrajectory.length-1)/(Math.ceil(r.sourceTrajectory.length/2)-1))]!),single(r.demonstrationId)),
    endpointOmittingDecimation:replay(r.sourceTrajectory.filter((_,i) => i%2===0),single(r.demonstrationId)),
    normal:replay(r.sourceTrajectory,single(r.demonstrationId)),
    double:replay(r.sourceTrajectory.flatMap((p,i,path) => [p,{...p,timestampMs:p.timestampMs+(path[i+1] ? (path[i+1]!.timestampMs-p.timestampMs)/2 : 1)}]),single(r.demonstrationId)),
    drops:replay(r.sourceTrajectory.filter((_,i) => i%7!==3),single(r.demonstrationId)),
    static:replay(r.sourceTrajectory.map(p => ({...r.sourceTrajectory[0]!,timestampMs:p.timestampMs})),single(r.demonstrationId)),
    partial:replay(r.sourceTrajectory.slice(0,Math.floor(r.sourceTrajectory.length/2)),single(r.demonstrationId))})),
  matrix:eligible.map(row => eligible.map(reference => replay(row.sourceTrajectory,single(reference.demonstrationId)))),
  performance:{} as Record<string,unknown>,dance:null as unknown,
};
const iterations=100;
for(const [name,references] of [["one",eligible.slice(0,1)],["all",eligible]] as const) {
  const tracker=new HeavyProgressTracker({...canonical,references},100);const timings:number[]=[];
  for(let i=0;i<iterations;i++) {const t=performance.now();tracker.update({...eligible[0]!.sourceTrajectory[i%eligible[0]!.sourceTrajectory.length]!,timestampMs:i*67});timings.push(performance.now()-t);}
  report.performance[name]={referenceCount:references.length,meanMs:timings.reduce((s,v) => s+v,0)/iterations,p95Ms:timings.sort((a,b) => a-b)[95]};
}
const transformStart=performance.now();for(let i=0;i<1000;i++) transform(eligible[0]!.sourceTrajectory[0]!.body3d!,canonical.statisticalCalibration!);
report.performance.oasTransformMeanMs=(performance.now()-transformStart)/1000;
if(fs.existsSync(`${root}/teacher-sequence.json`)) {
  const dance=JSON.parse(fs.readFileSync(`${root}/teacher-sequence.json`,"utf8")) as {lesson:Lesson};
  const path=dance.lesson.canonicalMovement.references![0]!.sourceTrajectory;
  report.dance={anchors:dance.lesson.canonicalMovement.anchors!.map(a => a.id),
    self:Object.fromEntries([20,50,75,80,100].map(d => [d,replay(path,dance.lesson.canonicalMovement,d)])),
    reverse:replay([...path].reverse().map((p,i) => ({...p,timestampMs:i*67})),dance.lesson.canonicalMovement),
    repeat:replay([...path,...path.map(p => ({...p,timestampMs:p.timestampMs+path.at(-1)!.timestampMs+1000}))],dance.lesson.canonicalMovement)};
}
fs.writeFileSync(`${root}/teacher-validation.json`,JSON.stringify(report,null,2));
const failures=Object.entries(report.self).flatMap(([difficulty,rows]) => rows.filter(r => r.completions!==1).map(r => ({difficulty,...r})));
const robustnessFailures=report.robustness.flatMap(r => ["half","normal","double","drops"].filter(k => (r[k as "half"]).completions!==1).map(k => ({id:r.id,mode:k,result:r[k as "half"]})));
console.log(JSON.stringify({eligible:eligible.length,selfFailures:failures,robustnessFailures,matrix:report.matrix.map(r => r.map(v => v.completions)),dance:report.dance,performance:report.performance},null,2));
if(!eligible.length || failures.length || robustnessFailures.length) process.exitCode=1;
else {
  const frozen={representation:canonical.representation,calibration:canonical.statisticalCalibration,references:canonical.references,segmentation:teacher.analysis};
  const serialized=JSON.stringify(frozen),sha256=createHash("sha256").update(serialized).digest("hex");
  fs.writeFileSync(`${root}/frozen-teacher.json`,serialized);
  fs.writeFileSync(`${root}/freeze.json`,JSON.stringify({sha256,teacherOnly:true,createdAt:new Date().toISOString()},null,2));
  console.log(`Frozen teacher SHA256 ${sha256}`);
}
