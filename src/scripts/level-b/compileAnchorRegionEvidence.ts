import fs from "node:fs";
import crypto from "node:crypto";
import { detectCyclesWithDiagnostics } from "../../frontend/analyze/CycleAnalyzer";
import { detectSequence } from "../../frontend/analyze/SequenceAnalyzer";
import { buildReferenceMovement, buildTeacherReference } from "../../frontend/lesson/ReferenceMovementBuilder";
import { buildRuntimeTargets } from "../../frontend/lesson/RuntimeTargets";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import type { Demonstration, MovementKind, PoseFrame } from "../../frontend/pose/pose.types";

const output = "test-results/movement/anchor-regions";
fs.mkdirSync(output, { recursive: true });
const paths = ["test-results/movement/3d/roi/lesson-squat-rtmw3d.json", "test-results/movement/3d/browser-movement-batched/teacher-cycle.json", "test-results/movement/3d/roi/lesson-dance-rtmw3d.json"];
const native = JSON.parse(fs.readFileSync(paths[0]!, "utf8")).frames as PoseFrame[];
const browser = JSON.parse(fs.readFileSync(paths[1]!, "utf8")).analysis.poseRecording.frames as PoseFrame[];
const dance = JSON.parse(fs.readFileSync(paths[2]!, "utf8")).frames as PoseFrame[];
// Physical demonstration delimiters only; no annotations of anchor positions/geometry.
const windows = [[8067,10533], [13000,16467], [18267,21067], [30733,39133], [42333,46600], [56867,63333]];
const compile = (demos: Demonstration[], kind: MovementKind) => {
  const confirmed = demos.map((d) => ({ ...d, teacherConfirmed: true, classification: "good" as const }));
  const references = confirmed.map((d) => buildTeacherReference(d, kind));
  try {
    const canonical = buildReferenceMovement(confirmed, kind);
    return { references, canonical, targetCounts: Object.fromEntries([1,20,50,75,80,99,100].map((d) => [d,buildRuntimeTargets(canonical,d).length])) };
  } catch (error) { return { references, canonical: null, error: String(error) }; }
};
const sets = Object.fromEntries(Object.entries({ native, browser }).map(([name, frames]) => {
  const demos = windows.map(([start,end], i): Demonstration => ({ id: `teacher-${i + 1}`, kind: "cycle", startMs: start!, endMs: end!,
    teacherConfirmed: true, classification: "good", trajectory: frames.filter((f) => f.timestampMs >= start! && f.timestampMs <= end!).map(normalizePose) }));
  const automatic = detectCyclesWithDiagnostics(frames);
  // Match by time-overlap only for reporting; these scores never feed construction.
  const segmentation = automatic.demonstrations.map((d) => ({ startMs: d.startMs, endMs: d.endMs, classification: d.classification,
    overlaps: windows.map(([start,end], i) => ({ teacher: i + 1, intersectionMs: Math.max(0,Math.min(end!,d.endMs)-Math.max(start!,d.startMs)),
      iou: Math.max(0,Math.min(end!,d.endMs)-Math.max(start!,d.startMs))/(Math.max(end!,d.endMs)-Math.min(start!,d.startMs)) })) }));
  return [name, { ...compile(demos, "cycle"), automatic: { diagnostics: automatic.diagnostics, segmentation, compilation: compile(automatic.demonstrations.filter((d) => d.classification !== "fragment"), "cycle") } }];
}));
const report = { inputSha256: Object.fromEntries(paths.map((p) => [p,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")])),
  annotationPolicy: "Physical boundaries only. No anchor annotations or view labels enter construction.", sets, dance: compile(detectSequence(dance), "sequence") };
fs.writeFileSync(`${output}/compiled.json`, JSON.stringify(report));
console.log(JSON.stringify({ sets: Object.fromEntries(Object.entries(sets).map(([name,s]) => [name, { references: s.references.map((r) => ({ id:r.demonstrationId, eligible:r.alignmentEligible, reason:r.rejectionReason,
  counts: [r.quality!.sourceSamples,r.quality!.reliableSamples], regions: Object.fromEntries(Object.entries(r.quality!.regions).map(([key,region]) => [key,region ? { samples: region.samples.length, startMs:region.startMs,endMs:region.endMs } : null])) })),
  predicted: s.automatic.segmentation.map(({startMs,endMs,classification}) => ({startMs,endMs,classification})) }])), dance: report.dance.references.map((r) => ({eligible:r.alignmentEligible,reason:r.rejectionReason})) },null,2));
