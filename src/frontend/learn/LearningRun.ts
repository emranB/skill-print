import { createId } from "../../shared/utils/id";
import { DebugBus } from "../debug/DebugBus";
import { buildRuntimeTargets, resolveCanonical } from "../lesson/RuntimeTargets";
import type { Lesson } from "../lesson/lesson.types";
import { normalizePose } from "../pose/PoseNormalizer";
import { isUsablePose, usabilityFloor } from "../pose/PoseUsability";
import type { PoseFrame } from "../pose/pose.types";
import type { RuntimeConfig } from "../../shared/config/config.types";
import { ProgressTracker } from "./ProgressTracker";
import { LocalProgressTracker } from "./LocalProgressTracker";
import { HeavyProgressTracker } from "./HeavyProgressTracker";
import { usableHeavy } from "../../shared/movement/HeavyBody";
import { ArticulatedProgressTracker } from "./ArticulatedProgressTracker";
import { usableArticulated } from "../../shared/movement/ArticulatedBody";

export class LearningRun {
  readonly tracker:
    ProgressTracker | LocalProgressTracker | HeavyProgressTracker | ArticulatedProgressTracker;
  private pending: Promise<unknown> = Promise.resolve();
  frames = 0;
  usableFrames = 0;
  reps = 0;
  sequenceComplete = false;
  private completedQualities: number[] = [];
  private summary: ReturnType<LearningRun["snapshot"]> | null = null;

  constructor(
    readonly lesson: Lesson,
    readonly config: RuntimeConfig,
    readonly source: "live" | "upload" | "fixture",
    readonly runId = createId(),
  ) {
    const canonical = resolveCanonical(lesson.canonicalMovement, lesson.demonstrations);
    this.tracker =
      canonical.representation === "mediapipe-articulated-3d-v1"
        ? new ArticulatedProgressTracker(canonical, config.pose.matchDifficulty)
        : canonical.representation === "mediapipe-heavy-body3d-v1"
          ? new HeavyProgressTracker(canonical, config.pose.matchDifficulty)
          : canonical.schemaVersion === 3
            ? new LocalProgressTracker(canonical, config.pose, runId, config.pose.matchDifficulty)
            : new ProgressTracker(
                canonical,
                buildRuntimeTargets(canonical, config.pose.matchDifficulty),
                config.pose,
              );
    DebugBus.emit({
      category: "STUDENT",
      event: "LEARN_RUN_STARTED",
      data: {
        runId: this.runId,
        source,
        matchDifficulty: config.pose.matchDifficulty,
        runtimeTargetCount: this.tracker.targets.length,
        trajectorySource: canonical.trajectorySource,
      },
    });
  }

  processStudentFrame(frame: PoseFrame) {
    if (this.tracker instanceof LocalProgressTracker)
      throw new Error("Use processFrame for asynchronous 3D alignment");
    if (this.summary) return null;
    this.frames++;
    const valid =
      this.tracker instanceof ArticulatedProgressTracker
        ? usableArticulated(frame.articulated3d)
        : this.tracker instanceof HeavyProgressTracker
          ? usableHeavy(frame.body3d)
          : isUsablePose(frame.landmarks, usabilityFloor(this.config.pose.minimumVisibility));
    if (valid) this.usableFrames++;
    const event =
      this.tracker instanceof HeavyProgressTracker ||
      this.tracker instanceof ArticulatedProgressTracker
        ? this.tracker.update(normalizePose(frame))
        : this.tracker.update(normalizePose(frame, this.config.pose.minimumVisibility), valid);
    if (event?.type === "REP_SUCCESS") this.reps++;
    if (event?.type === "SEQUENCE_COMPLETE") this.sequenceComplete = true;
    if (
      (event?.type === "REP_SUCCESS" || event?.type === "SEQUENCE_COMPLETE") &&
      this.tracker instanceof ArticulatedProgressTracker
    ) {
      const quality = this.tracker.diagnostics().completionQualityPercent;
      if (quality !== null) this.completedQualities.push(quality);
    }
    if (event && event.type !== "MISMATCH")
      DebugBus.emit({
        category: "STUDENT",
        event: event.type,
        data: {
          ...event,
          runId: this.runId,
          source: this.source,
          timestampMs: frame.timestampMs,
          ...this.tracker.diagnostics(),
        },
      });
    return event;
  }

  processFrame(frame: PoseFrame): Promise<ReturnType<LearningRun["processStudentFrame"]>> {
    if (!(this.tracker instanceof LocalProgressTracker))
      return Promise.resolve(this.processStudentFrame(frame));
    const tracker = this.tracker;
    const result = this.pending.then(async () => {
      if (this.summary) return null;
      this.frames++;
      const event = await tracker.update(normalizePose(frame), frame.streamId, frame.alignment);
      if (
        frame.bodySkeleton?.orientationReliable &&
        frame.bodySkeleton.boneConfidence.filter((c) => c >= 0.5).length >= 6
      )
        this.usableFrames++;
      if (event?.type === "REP_SUCCESS") this.reps++;
      if (event?.type === "SEQUENCE_COMPLETE") this.sequenceComplete = true;
      if (event && event.type !== "MISMATCH")
        DebugBus.emit({
          category: "STUDENT",
          event: event.type,
          data: {
            ...event,
            runId: this.runId,
            source: this.source,
            timestampMs: frame.timestampMs,
            ...tracker.diagnostics(),
          },
        });
      return event;
    });
    this.pending = result;
    return result;
  }

  async finishAsync(termination: "eof" | "user" | "cancelled" | "error", corrections = 0) {
    try {
      await this.pending;
    } catch {
      termination = "error";
    }
    return this.finish(termination, corrections);
  }

  private snapshot(termination: string, corrections: number) {
    return {
      runId: this.runId,
      matchDifficulty: this.config.pose.matchDifficulty,
      angleWeight:
        this.lesson.canonicalMovement.schemaVersion === 3 ? 0 : (this.config.pose.angleWeight ?? 0),
      maximumProgressPercent: this.tracker.diagnostics().furthestProgressPercent,
      source: this.source,
      frames: this.frames,
      usableFrames: this.usableFrames,
      reps: this.reps,
      sequenceComplete: this.sequenceComplete,
      coaching: { corrections },
      mastery: this.sequenceComplete || this.reps > 0,
      matchQualityPercent: this.matchQualityPercent,
      termination,
      incompleteReason: this.tracker.finish(),
      ...this.tracker.diagnostics(),
    };
  }

  get matchQualityPercent(): number | null {
    if (!(this.tracker instanceof ArticulatedProgressTracker)) return null;
    if (this.completedQualities.length)
      return (
        this.completedQualities.reduce((sum, q) => sum + q, 0) / this.completedQualities.length
      );
    return this.tracker.diagnostics().qualityPercent;
  }

  finish(termination: "eof" | "user" | "cancelled" | "error", corrections = 0) {
    if (this.summary) return this.summary;
    this.summary = this.snapshot(termination, corrections);
    DebugBus.emit({ category: "STUDENT", event: "LEARN_EVALUATION_COMPLETE", data: this.summary });
    return this.summary;
  }
}
