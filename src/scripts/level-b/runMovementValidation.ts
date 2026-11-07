import { analyzeTeachingSession } from "../../frontend/analyze/SessionAnalyzer";
import { RuntimeConfigManager } from "../../frontend/config/RuntimeConfig";
import { captureBodyCalibration } from "../../frontend/calibration/BodyCalibration";
import { compileLesson } from "../../frontend/lesson/LessonCompiler";
import { buildRuntimeTargets } from "../../frontend/lesson/RuntimeTargets";
import { LearningRun } from "../../frontend/learn/LearningRun";
import { LearnerVideo } from "../../frontend/learn/LearnerVideo";
import { DebugBus } from "../../frontend/debug/DebugBus";
import { CoachingSession } from "../../frontend/learn/CoachingSession";
import { MockApprenticeGateway } from "../../frontend/apprentice/MockApprenticeGateway";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import type { PoseFrame } from "../../frontend/pose/pose.types";

/** Test harness; expert labels are explicitly simulated, never inferred from a filename. */
export async function compileTeacherFixture(url: string, kind: "cycle" | "sequence") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Video fetch failed: ${response.status}`);
  const blob = await response.blob();
  const analysis = await analyzeTeachingSession({ schemaVersion: 1, id: "validation-media", source: "upload", durationMs: 0, video: blob }, {
    sessionId: "movement-validation", kind, configSnapshot: RuntimeConfigManager.snapshot(),
  });
  const demos = analysis.demonstrations.map((d) => d.classification === "fragment" ? d : { ...d, classification: "good" as const, teacherConfirmed: true });
  const first = analysis.poseRecording.frames.find((f) => f.timestampMs >= (demos.find((d) => d.classification === "good")?.startMs ?? 0));
  if (!first) throw new Error("No teacher poses");
  const calibration = captureBodyCalibration(first);
  const lesson = compileLesson({ kind, name: "Validation lesson", sourceSessionId: analysis.sessionId, teacherCalibration: calibration,
    referencePose: calibration.neutralPose, demonstrations: demos, questions: [] });
  return { lesson, analysis, targetCounts: Object.fromEntries([1, 20, 50, 75, 80, 99, 100].map((d) => [d, buildRuntimeTargets(lesson.canonicalMovement, d).length])),
    extractionStats: DebugBus.getEvents().filter(e => e.event === "POSE_EXTRACT_COMPLETE").at(-1)?.data,
    simulated: "All complete teacher takes were labelled good and confirmed by the test harness; no human judgment is claimed." };
}

export async function evaluateLearnerVideo(url: string, lesson: Lesson, matchDifficulty: number, angleWeight = 0) {
  const config = structuredClone(RuntimeConfigManager.get()); config.pose.matchDifficulty = matchDifficulty;
  config.pose.angleWeight = angleWeight;
  const run = new LearningRun(lesson, config, "upload");
  const gateway = new MockApprenticeGateway();
  const coaching = new CoachingSession(gateway, config.coaching, lesson, await gateway.prepareLearning({ lesson }), config.pose.minimumVisibility, run.tracker.targets);
  const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.src = url;
  document.body.appendChild(video);
  const frames: PoseFrame[] = [];
  const trace: Array<Record<string, unknown>> = [];
  let calibration: Record<string, number> | null = null;
  let controller: LearnerVideo | null = null;
  const completed = new Promise<ReturnType<LearningRun["finish"]>>((resolve, reject) => {
    controller = new LearnerVideo(video, { fps: config.pose.sampleFps, minimumVisibility: config.pose.minimumVisibility, legacy: lesson.canonicalMovement.schemaVersion !== 3, representation: lesson.canonicalMovement.representation,
      runId: run.runId,
      onCalibrated: (f) => {
        calibration = { windowStartMs: f.timestampMs, rewindMs: video.currentTime * 1000 };
        void controller!.begin().catch(reject);
      },
      onFrame: async (f) => {
        frames.push(f);
        const event = await run.processFrame(f);
        const cue = event ? coaching.handleTrackerEvent(f.timestampMs, event, normalizePose(f, config.pose.minimumVisibility),run.tracker.getGhostTarget()) : null;
        trace.push({ timestampMs: f.timestampMs, event, cue, ...run.tracker.diagnostics() });
      },
      onComplete: (reason) => { void run.finishAsync(reason, coaching.correctionCount).then(resolve, reject); }, onError: reject,
    });
    void controller.calibrate().catch(reject);
  });
  try {
    const summary = await completed;
    run.finish("eof");
    const evaluationEvents = DebugBus.getEvents().filter((e) => e.event === "LEARN_EVALUATION_COMPLETE" && (e.data as { runId?: string })?.runId === run.runId).length;
    return { summary, calibration, trace, frames, evaluationEvents };
  } finally { (controller as LearnerVideo | null)?.dispose(); video.remove(); video.removeAttribute("src"); video.load(); }
}
