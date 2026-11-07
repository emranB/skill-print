import fs from "node:fs";
import { HeavyProgressTracker } from "../../frontend/learn/HeavyProgressTracker";
import { featureDistance, transform } from "../../shared/movement/OAS";
import type { Lesson } from "../../frontend/lesson/lesson.types";
const {lesson}=JSON.parse(fs.readFileSync("test-results/movement/heavy-v1/teacher-cycle.json","utf8")) as {lesson:Lesson};
const canonical=lesson.canonicalMovement,reference=canonical.references![Number(process.argv[2] ?? 3)]!;
const tracker=new HeavyProgressTracker({...canonical,references:[reference]},75);
const trace=reference.sourceTrajectory.filter((_,i) => i%2===0).map(p => {
  const event=tracker.update(p);
  const nearest=reference.samples.map(s => ({p:s.progress01,d:featureDistance(transform(p.body3d!,canonical.statisticalCalibration!),transform(s.pose.body3d!,canonical.statisticalCalibration!))})).sort((a,b) => a.d-b.d)[0];
  return {t:p.timestampMs,event,nearest,...tracker.diagnostics()};
});
fs.writeFileSync(`test-results/movement/heavy-v1/self-trace-${process.argv[2] ?? 3}.json`,JSON.stringify(trace,null,2));
console.log(JSON.stringify(trace.map(r => ({t:r.t,p:r.currentProgressPercent,nearest:r.nearest,r:r.reason,d:r.localDistance})),null,2));
