import fs from "node:fs";
import { measureAngleErrors } from "../../frontend/pose/PoseAngles";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import { buildRuntimeTargets, sampleCanonical } from "../../frontend/lesson/RuntimeTargets";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import type { PoseFrame } from "../../frontend/pose/pose.types";

const { lesson } = JSON.parse(fs.readFileSync("test-results/movement/teacher-cycle.json", "utf8")) as { lesson: Lesson };
const raw = JSON.parse(fs.readFileSync("test-results/movement/position-75.json", "utf8")) as {
  frames: PoseFrame[]; trace: Array<{ timestampMs: number; currentProgressPercent: number; runtimeTargetIndex: number }>;
};
const targets = buildRuntimeTargets(lesson.canonicalMovement, 75);
// Human observations of this test clip only. These labels never enter the production pipeline.
const observations = [{ name: "walking_setup_exit", fromMs: 0, toMs: 3000 }, { name: "front_view", fromMs: 3000, toMs: 18000 },
  { name: "side_view", fromMs: 18000, toMs: 31000 }, { name: "walking_setup_exit", fromMs: 31000, toMs: Infinity }];
const measurements = raw.frames.map((frame, i) => {
  const trace = raw.trace[i]!;
  const current = sampleCanonical(lesson.canonicalMovement.samples!, trace.currentProgressPercent / 100);
  const target = targets[trace.runtimeTargetIndex] ?? current;
  const pose = normalizePose(frame);
  return { timestampMs: frame.timestampMs, observation: observations.find((w) => frame.timestampMs >= w.fromMs && frame.timestampMs < w.toMs)!.name,
    currentProgressPercent: trace.currentProgressPercent, anglesAtCurrentProgress: measureAngleErrors(pose, current.pose, 0.65), anglesAtGhostTarget: measureAngleErrors(pose, target.pose, 0.65) };
});
const summaries = ["all", "front_view", "side_view", "walking_setup_exit"].map((group) => {
  const rows = measurements.filter((r) => group === "all" || r.observation === group);
  const errors = rows.flatMap((r) => r.anglesAtCurrentProgress);
  return { group, frames: rows.length, joints: [...new Set(errors.map((e) => e.name))].map((name) => {
    const values = errors.filter((e) => e.name === name).map((e) => e.errorDegrees).sort((a, b) => a - b);
    return { name, pairs: values.length, meanDegrees: values.reduce((a, b) => a + b, 0) / values.length,
      medianDegrees: values[Math.floor(values.length / 2)], p95Degrees: values[Math.floor((values.length - 1) * 0.95)] };
  }) };
});
const result = { source: "POSITION-only difficulty-75 VIDEO observations", floor: 0.65, minProjectedLimbLength: 0.1, summaries, measurements };
fs.writeFileSync("test-results/movement/angle-measurements.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(summaries, null, 2));
