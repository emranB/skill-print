import fs from "node:fs";
import { createHash } from "node:crypto";
import { HeavyProgressTracker } from "../../frontend/learn/HeavyProgressTracker";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import type { PoseFrame } from "../../frontend/pose/pose.types";
import type { Lesson } from "../../frontend/lesson/lesson.types";

const root = "test-results/movement/heavy-v1";
const frozen = fs.readFileSync(`${root}/frozen-teacher.json`, "utf8");
const freeze = JSON.parse(fs.readFileSync(`${root}/freeze.json`, "utf8")) as { sha256: string };
if (createHash("sha256").update(frozen).digest("hex") !== freeze.sha256) throw new Error("Frozen teacher changed");
const { lesson } = JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`, "utf8")) as { lesson: Lesson };
const windows = [
  { name: "front-1", start: 9000, end: 14000 },
  { name: "front-2", start: 14000, end: 18000 },
  { name: "side-1", start: 23000, end: 28000 },
  { name: "side-2", start: 28000, end: 33000 },
]; // Diagnostic annotations only; never passed into production matching/calibration.
const negatives = [
  { name: "setup-walking", start: 0, end: 9000 },
  { name: "turn-standing", start: 18000, end: 23000 },
  { name: "exit", start: 33000, end: Infinity },
];
function replay(frames: PoseFrame[], difficulty: number) {
  const tracker = new HeavyProgressTracker(lesson.canonicalMovement, difficulty);
  const completions: unknown[] = [];
  const reasons: Record<string, number> = {};
  for (const frame of frames) {
    const event = tracker.update(normalizePose(frame));
    const diagnostic = tracker.diagnostics();
    reasons[diagnostic.reason] = (reasons[diagnostic.reason] ?? 0) + 1;
    if (event?.type === "REP_SUCCESS") completions.push({ timestampMs: frame.timestampMs, ...diagnostic });
  }
  return { frames: frames.length, reps: completions.length, completions, reasons, ...tracker.diagnostics() };
}
const results = [20, 50, 75, 80, 100].map(difficulty => {
  const result = JSON.parse(fs.readFileSync(`${root}/learner-${difficulty}.json`, "utf8")) as {
    frames: PoseFrame[]; trace: Array<{ timestampMs: number; currentProgressPercent: number; event?: { type: string }; referenceId: string }>;
    summary: unknown; wallMs: number; calibration: unknown; evaluationEvents: number; frozenSha256: string;
  };
  if (result.frozenSha256 !== freeze.sha256) throw new Error("Learner used another teacher calibration");
  const segment = (window: { name: string; start: number; end: number }) => {
    const frames = result.frames.filter(f => f.timestampMs >= window.start && f.timestampMs < window.end);
    const trace = result.trace.filter(f => f.timestampMs >= window.start && f.timestampMs < window.end);
    return { ...window, independent: replay(frames, difficulty), continuous: {
      maximum: Math.max(0, ...trace.map(t => t.currentProgressPercent)),
      successes: trace.filter(t => t.event?.type === "REP_SUCCESS").map(t => ({ timestampMs: t.timestampMs, referenceId: t.referenceId })),
    } };
  };
  return { difficulty, summary: result.summary, wallMs: result.wallMs, calibration: result.calibration,
    evaluationEvents: result.evaluationEvents, attempts: windows.map(segment), negatives: negatives.map(segment),
    fullReplay: replay(result.frames, difficulty) };
});
const report = { frozenSha256: freeze.sha256, reportingOnlyWindows: true, results };
fs.writeFileSync(`${root}/learner-validation.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
