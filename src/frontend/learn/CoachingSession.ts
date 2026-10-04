import type { RuntimeConfig } from "../../shared/config/config.types";
import type { ApprenticeGateway, LearnPreparation } from "../apprentice/ApprenticeGateway";
import type { Lesson } from "../lesson/lesson.types";
import type { NormalizedPoseGeometry } from "../pose/pose.types";
import type { CheckpointTrackerEvent } from "./CheckpointTracker";
import { describeDeviation, largestDeviation } from "./PoseDeviation";

/**
 * Decides when to coach and composes the cue: a geometric correction computed
 * here (which joint, which way) plus the apprentice's prepared cue for the
 * current movement phase. No model call happens during practice.
 */
export class CoachingSession {
  private mismatchSince: number | null = null;
  private lastPromptAt = Number.NEGATIVE_INFINITY;
  correctionCount = 0;

  constructor(
    private readonly gateway: ApprenticeGateway,
    private readonly coaching: RuntimeConfig["coaching"],
    private readonly lesson: Lesson,
    private readonly preparation: LearnPreparation | null,
    private readonly visibilityFloor: number,
  ) {}

  resetMismatch(): void {
    this.mismatchSince = null;
  }

  handleTrackerEvent(
    timestampMs: number,
    event: CheckpointTrackerEvent,
    pose: NormalizedPoseGeometry,
  ): string | null {
    if (event.type !== "MISMATCH") {
      this.resetMismatch();
      return null;
    }
    if (this.mismatchSince === null) {
      this.mismatchSince = timestampMs;
      return null;
    }
    if (timestampMs - this.mismatchSince < this.coaching.mismatchPersistenceMs) return null;
    if (timestampMs - this.lastPromptAt < this.coaching.minimumPromptIntervalMs) return null;

    this.lastPromptAt = timestampMs;
    this.correctionCount += 1;

    const expected = this.lesson.canonicalMovement.checkpoints[event.index];
    const deviation = expected ? largestDeviation(pose, expected.pose, this.visibilityFloor) : null;
    const phaseCue = expected ? this.preparation?.cues[expected.phase] : undefined;
    const cue =
      [deviation ? describeDeviation(deviation) : null, phaseCue].filter(Boolean).join(" ") ||
      (expected ? `Match the teacher at ${expected.progress}% ${expected.phase}.` : "Match the teacher.");

    void this.gateway.sendContextualUpdate?.({
      lessonId: this.lesson.id,
      mismatchIndex: event.index,
      similarity: event.similarity,
      joint: deviation?.name,
      direction: deviation?.direction,
    });
    return cue;
  }
}
