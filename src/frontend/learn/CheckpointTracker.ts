import { comparePose } from "../pose/PoseComparator";
import { poseSimilarity } from "../pose/PoseDistance";
import type { CanonicalCheckpoint, NormalizedPose } from "../pose/pose.types";

export type CheckpointTrackerEvent =
  | { type: "CHECKPOINT_PASSED"; index: number; progress: number; phase: string }
  | { type: "REP_SUCCESS" }
  | { type: "MISMATCH"; index: number; similarity: number };

export interface CheckpointTrackerOptions {
  leniency: number;
  minimumVisibility: number;
  checkpointHoldMs: number;
}

/**
 * Sequential checkpoint traversal:
 * 0, 25, 50, 75, 100, 75, 50, 25, 0
 * Closest-pose jumping is forbidden. Final return to 0 required for REP_SUCCESS.
 */
export class CheckpointTracker {
  private expectedIndex = 0;
  private holdStartedAt: number | null = null;
  private awaitLeavePrevious = false;
  private previousIndex: number | null = null;
  private readonly checkpoints: CanonicalCheckpoint[];
  private readonly options: CheckpointTrackerOptions;
  /** Similarity of the latest pose to the expected checkpoint (0 to 1). */
  lastSimilarity = 0;

  constructor(checkpoints: CanonicalCheckpoint[], options: CheckpointTrackerOptions) {
    this.checkpoints = checkpoints;
    this.options = options;
  }

  reset(): void {
    this.lastSimilarity = 0;
    this.expectedIndex = 0;
    this.holdStartedAt = null;
    this.awaitLeavePrevious = false;
    this.previousIndex = null;
  }

  /** Planar like the teacher-side analysis: monocular depth is too noisy to compare across sessions. */
  private similarity(pose: NormalizedPose, target: CanonicalCheckpoint["pose"]): number {
    return poseSimilarity(pose, target, { minimumVisibility: this.options.minimumVisibility, planar: true });
  }

  getExpectedIndex(): number {
    return this.expectedIndex;
  }

  update(pose: NormalizedPose, trackingValid: boolean): CheckpointTrackerEvent | null {
    const expected = this.checkpoints[this.expectedIndex];
    if (!expected) return null;

    const expectedSim = this.similarity(pose, expected.pose);
    this.lastSimilarity = expectedSim;

    if (this.awaitLeavePrevious && this.previousIndex !== null) {
      const prevSim = this.similarity(pose, this.checkpoints[this.previousIndex]!.pose);
      // Re-arm once the live pose is at least as close to the next target as to the previous.
      if (expectedSim + 0.01 >= prevSim) {
        this.awaitLeavePrevious = false;
      } else {
        return {
          type: "MISMATCH",
          index: this.expectedIndex,
          similarity: expectedSim,
        };
      }
    }

    const result = comparePose(pose, expected.pose, {
      leniency: this.options.leniency,
      minimumVisibility: this.options.minimumVisibility,
      trackingValid,
    });
    this.lastSimilarity = result.similarity;

    // Anti-skip: refuse advance when a much later checkpoint is clearly the better match.
    if (result.passed && trackingValid) {
      for (let i = this.expectedIndex + 2; i < this.checkpoints.length; i += 1) {
        const futureSim = this.similarity(pose, this.checkpoints[i]!.pose);
        if (futureSim > result.similarity + 0.08) {
          this.holdStartedAt = null;
          return {
            type: "MISMATCH",
            index: this.expectedIndex,
            similarity: result.similarity,
          };
        }
      }
    }

    if (!result.passed) {
      this.holdStartedAt = null;
      return {
        type: "MISMATCH",
        index: this.expectedIndex,
        similarity: result.similarity,
      };
    }

    if (this.holdStartedAt === null) {
      this.holdStartedAt = pose.timestampMs;
      return null;
    }

    if (pose.timestampMs - this.holdStartedAt < this.options.checkpointHoldMs) {
      return null;
    }

    const passedIndex = this.expectedIndex;
    const passedProgress = expected.progress;
    const passedPhase = expected.phase;
    this.holdStartedAt = null;
    this.previousIndex = passedIndex;

    if (this.expectedIndex >= this.checkpoints.length - 1) {
      this.expectedIndex = 0;
      this.awaitLeavePrevious = false;
      this.previousIndex = null;
      return { type: "REP_SUCCESS" };
    }

    this.expectedIndex += 1;
    this.awaitLeavePrevious = true;
    return {
      type: "CHECKPOINT_PASSED",
      index: passedIndex,
      progress: passedProgress,
      phase: passedPhase,
    };
  }
}
