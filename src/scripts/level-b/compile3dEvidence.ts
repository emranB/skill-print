import fs from "node:fs";
import { detectCyclesWithDiagnostics } from "../../frontend/analyze/CycleAnalyzer";
import { detectSequence } from "../../frontend/analyze/SequenceAnalyzer";
import { buildCanonicalMovement } from "../../frontend/lesson/CanonicalMovementBuilder";
import { buildRuntimeTargets } from "../../frontend/lesson/RuntimeTargets";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import { poseDistance } from "../../frontend/pose/PoseDistance";
import type { Demonstration, PoseFrame } from "../../frontend/pose/pose.types";

const directory = "test-results/movement/3d/roi";
const read = (name: string) => JSON.parse(fs.readFileSync(`${directory}/${name}-rtmw3d.json`, "utf8")) as { frames: PoseFrame[] };
const teacher = read("lesson-squat").frames;
const automatic = detectCyclesWithDiagnostics(teacher);
const compile = (demos: Demonstration[], kind: "cycle" | "sequence") => {
  try {
    const canonical = buildCanonicalMovement(demos.map((d) => ({ ...d, teacherConfirmed: true, classification: "good" })), kind);
    return { canonical, targetCounts: Object.fromEntries([1,20,50,75,80,99,100].map((d) => [d, buildRuntimeTargets(canonical, d).length])) };
  } catch (error) { return { error: String(error) }; }
};
// Accepted annotation windows are evaluation metadata only; none enter production selection.
const annotatedWindows = [[8067,10533], [13000,16467], [18267,21067], [30733,39133], [42333,46600], [56867,63333]];
const six = annotatedWindows.map(([start, end], index): Demonstration => {
  const trajectory = teacher.filter((f) => f.timestampMs >= start! && f.timestampMs <= end!).map((f) => normalizePose(f));
  const apex = trajectory.reduce((a, b) => {
    const da = poseDistance(a, trajectory[0]!);
    const db = poseDistance(b, trajectory[0]!);
    return Number.isFinite(db) && (!Number.isFinite(da) || db > da) ? b : a;
  });
  return { id: `teacher-${index + 1}`, startMs: trajectory[0]!.timestampMs, endMs: trajectory.at(-1)!.timestampMs,
    apexMs: apex.timestampMs, classification: "good", teacherConfirmed: true, kind: "cycle", trajectory };
});
const separate = six.map((demo) => ({ id: demo.id, apexMs: demo.apexMs, frames: demo.trajectory.length, ...compile([demo], "cycle") }));
const viable = separate.filter((r) => r.canonical).map((r) => r.canonical!.references![0]!);
const combined = viable.length ? compile(six,"cycle").canonical : null;
const dance = detectSequence(read("lesson-dance").frames);
const report = { automatic: { diagnostics: automatic.diagnostics, compilation: compile(automatic.demonstrations.filter((d) => d.classification !== "fragment"), "cycle") },
  annotatedSix: separate, combined, dance: { demonstrations: dance.length, ...compile(dance, "sequence") },
  annotationStatus: "Accepted physical teacher windows; labels are simulated evaluation confirmations. Apex is recomputed from 3D geometry, not inherited 2D elapsed progress." };
fs.writeFileSync("test-results/movement/3d/compiled.json", JSON.stringify(report));
console.log(JSON.stringify({ automatic: automatic.diagnostics, references: separate.map(({id,frames,apexMs,error}) => ({id,frames,apexMs,error})), dance: report.dance.error ?? report.dance.targetCounts }, null, 2));
