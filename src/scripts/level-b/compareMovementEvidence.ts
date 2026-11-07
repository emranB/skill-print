import fs from "node:fs";
import { LearningRun } from "../../frontend/learn/LearningRun";
import { RuntimeConfigManager } from "../../frontend/config/RuntimeConfig";
import { CoachingSession } from "../../frontend/learn/CoachingSession";
import { MockApprenticeGateway } from "../../frontend/apprentice/MockApprenticeGateway";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import { anglePenalty } from "../../frontend/pose/PoseAngles";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import type { PoseFrame } from "../../frontend/pose/pose.types";

const { lesson } = JSON.parse(fs.readFileSync("test-results/movement/teacher-cycle.json", "utf8")) as { lesson: Lesson };
// Observer annotations for empirical reporting only, never passed to production scoring.
const windows = [{ name: "setup_walking", from: 0, to: 3000 }, { name: "front", from: 3000, to: 18000 },
  { name: "side", from: 18000, to: 31000 }, { name: "exit", from: 31000, to: Infinity }];
const results = [];
for (const difficulty of [20, 50, 75, 80, 100]) {
  const raw = JSON.parse(fs.readFileSync(`test-results/movement/position-${difficulty}.json`, "utf8")) as { frames: PoseFrame[] };
  for (const angleWeight of [0, 0.05]) {
    const config = structuredClone(RuntimeConfigManager.get());
    config.pose.matchDifficulty = difficulty; config.pose.angleWeight = angleWeight;
    const run = new LearningRun(lesson, config, "fixture");
    const gateway = new MockApprenticeGateway();
    const coaching = new CoachingSession(gateway, config.coaching, lesson, await gateway.prepareLearning({ lesson }), config.pose.minimumVisibility, run.tracker.targets);
    const trace = raw.frames.map((f) => {
      const pose = normalizePose(f, config.pose.minimumVisibility);
      const target = run.tracker.getGhostTarget();
      const angles = target ? anglePenalty(pose, target.pose, config.pose.minimumVisibility, angleWeight) : { penalty: 0, reliableChains: 0 };
      const event = run.processStudentFrame(f);
      const cue = event ? coaching.handleTrackerEvent(f.timestampMs, event, pose) : null;
      return { timestampMs: f.timestampMs, event, cue, ...angles, ...run.tracker.diagnostics() };
    });
    const summary = run.finish("eof", coaching.correctionCount);
    const observations = windows.map((w) => {
      const rows = trace.filter((r) => r.timestampMs >= w.from && r.timestampMs < w.to);
      return { name: w.name, frames: rows.length, successfulReps: rows.filter((r) => r.event?.type === "REP_SUCCESS").length,
        maximumProgressPercent: Math.max(0, ...rows.map((r) => r.currentProgressPercent)), anglePenaltyFrames: rows.filter((r) => r.penalty > 0).length };
    });
    const result = { summary, observations, anglePenaltyFrames: trace.filter((r) => r.penalty > 0).length,
      maximumAnglePenalty: Math.max(0, ...trace.map((r) => r.penalty)), trace };
    fs.writeFileSync(`test-results/movement/paired-${angleWeight ? "angles" : "position"}-${difficulty}.json`, JSON.stringify(result));
    results.push({ summary, observations, anglePenaltyFrames: result.anglePenaltyFrames, maximumAnglePenalty: result.maximumAnglePenalty });
  }
}
fs.writeFileSync("test-results/movement/paired-matrix.json", JSON.stringify({ source: "Exactly the same captured VIDEO poses for each POSITION/ANGLES pair; no re-extraction", results }, null, 2));
console.log(JSON.stringify(results, null, 2));
