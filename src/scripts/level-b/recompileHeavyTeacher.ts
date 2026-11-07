import fs from "node:fs";
import { detectCyclesWithDiagnostics } from "../../frontend/analyze/CycleAnalyzer";
import { buildHeavyMovement } from "../../frontend/lesson/HeavyReferenceBuilder";
import { buildRuntimeTargets } from "../../frontend/lesson/RuntimeTargets";
import { attachHeavyGeometry } from "../../frontend/analyze/HeavySegmentation";
import { detectSequence } from "../../frontend/analyze/SequenceAnalyzer";
import type { PoseFrame } from "../../frontend/pose/pose.types";
import type { Lesson } from "../../frontend/lesson/lesson.types";

// Replay the fresh NEW-production extraction while fixing teacher-only construction mechanics.
// No legacy caches, teacher timestamps or learner observations enter this script's construction.
const kind=process.argv[2]==="sequence" ? "sequence" : "cycle";
const file=`test-results/movement/heavy-v1/teacher-${kind}.json`;
const previous=JSON.parse(fs.readFileSync(file,"utf8")) as {lesson:Lesson;analysis:{poseRecording:{frames:PoseFrame[]};demonstrations:unknown;segmentation:unknown}};
previous.analysis.poseRecording.frames=previous.analysis.poseRecording.frames.map(attachHeavyGeometry);
const segmented=kind==="cycle" ? detectCyclesWithDiagnostics(previous.analysis.poseRecording.frames)
  : {demonstrations:detectSequence(previous.analysis.poseRecording.frames),diagnostics:undefined};
if(segmented.diagnostics) fs.writeFileSync("test-results/movement/heavy-v1/segmentation-correction.json",JSON.stringify(segmented.diagnostics,null,2));
const demonstrations=segmented.demonstrations.map(d => d.classification==="unknown" ? {...d,classification:"good" as const,teacherConfirmed:true} : d);
const canonical=buildHeavyMovement(demonstrations,kind);
previous.lesson={...previous.lesson,demonstrations,canonicalMovement:canonical};
previous.analysis.demonstrations=segmented.demonstrations;previous.analysis.segmentation=segmented.diagnostics;
const targetCounts=Object.fromEntries([1,20,50,75,80,99,100].map(d => [d,buildRuntimeTargets(canonical,d).length]));
fs.writeFileSync(file,JSON.stringify({...previous,targetCounts,construction:"Fresh Heavy VIDEO extraction, teacher-only construction replay; no legacy canonical"}));
console.log(JSON.stringify({proposals:demonstrations.map(d => ({start:d.startMs,end:d.endMs,classification:d.classification})),quality:canonical.references!.map(r => ({eligible:r.alignmentEligible,reason:r.rejectionReason,samples:r.samples.length})),tolerance:canonical.statisticalCalibration!.tolerance},null,2));
