import fs from "node:fs";
import { RuntimeConfigManager } from "../../frontend/config/RuntimeConfig";
import { LearningRun } from "../../frontend/learn/LearningRun";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import type { PoseFrame } from "../../frontend/pose/pose.types";

const lessonFile = process.argv[2];
const framesFile = process.argv[3];
if (!lessonFile || !framesFile) throw new Error("Usage: replayMovementEvidence.ts LESSON_JSON FRAMES_JSON");
const document = JSON.parse(fs.readFileSync(lessonFile, "utf8")) as Lesson & { lesson?: Lesson };
const lesson = document.lesson ?? document;
const { frames } = JSON.parse(fs.readFileSync(framesFile, "utf8")) as { frames: PoseFrame[] };
const run = new LearningRun(lesson, RuntimeConfigManager.get(), "fixture");
for (const frame of frames) {
  const event = run.processStudentFrame(frame);
  if (event && event.type !== "MISMATCH") console.log(JSON.stringify({ timestampMs: frame.timestampMs, event, ...run.tracker.diagnostics() }));
}
console.log(JSON.stringify(run.finish("eof"), null, 2));
