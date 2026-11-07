import {
  ARTICULATED_REPRESENTATION,
  ARTICULATED_TOLERANCE,
  ARTICULATED_CONFIDENCE,
  articulatedDistance,
  usableArticulated,
  type ArticulatedBody,
} from "../../shared/movement/ArticulatedBody";
import { buildRuntimeTargets } from "../lesson/RuntimeTargets";
import type { CanonicalMovement, MovementReference, NormalizedPose } from "../pose/pose.types";
import type { ProgressTrackerEvent } from "./ProgressTracker";
import { compactExecution } from "./CompletedMovementScorer";
import { scoreAlignedTargets, type AlignedError } from "./AlignedMovementQuality";

export const MAX_FORWARD_TARGETS = 3;

function sameMotionDirection(
  teacherStart: ArticulatedBody,
  target: ArticulatedBody,
  learnerStart: ArticulatedBody,
  learner: ArticulatedBody,
) {
  let dot = 0;
  teacherStart.bones.forEach((a, i) => {
    const b = target.bones[i],
      c = learnerStart.bones[i],
      d = learner.bones[i];
    if (
      a &&
      b &&
      c &&
      d &&
      Math.min(
        teacherStart.boneConfidence[i]!,
        target.boneConfidence[i]!,
        learnerStart.boneConfidence[i]!,
        learner.boneConfidence[i]!,
      ) >= ARTICULATED_CONFIDENCE
    )
      dot += 3 * a.reduce((sum, v, j) => sum + (b[j]! - v) * (d[j]! - c[j]!), 0);
  });
  teacherStart.bends.forEach((a, i) => {
    const b = target.bends[i],
      c = learnerStart.bends[i],
      d = learner.bends[i];
    if (
      a !== null &&
      b != null &&
      c != null &&
      d != null &&
      Math.min(
        teacherStart.bendConfidence[i]!,
        target.bendConfidence[i]!,
        learnerStart.bendConfidence[i]!,
        learner.bendConfidence[i]!,
      ) >= ARTICULATED_CONFIDENCE
    )
      dot += ((b - a) * (d - c)) / (Math.PI * Math.PI);
  });
  return dot >= -1e-8;
}

class Candidate {
  buffer: NormalizedPose[] = [];
  index = 0;
  maximum = 0;
  reason = "awaiting_start";
  lastMs: number | null = null;
  peak = 0;
  travel = 0;
  holdStart: number | null = null;
  restarts = 0;
  distance = Infinity;
  lastScore: ReturnType<typeof scoreAlignedTargets> | null = null;
  evaluationStartMs: number | undefined;
  errors: AlignedError[] = [];
  alignmentOrigin: NormalizedPose | null = null;
  readonly targets;
  readonly targetArc: number;
  constructor(
    readonly reference: MovementReference,
    readonly canonical: CanonicalMovement,
    difficulty: number,
    readonly tolerance: number,
  ) {
    this.targets = buildRuntimeTargets(
      {
        ...canonical,
        samples: reference.samples,
        anchors: reference.anchors,
        references: [reference],
      },
      difficulty,
    );
    this.targetArc = this.targets.reduce(
      (sum, target, i) =>
        i === 0
          ? sum
          : sum +
            articulatedDistance(
              this.targets[i - 1]!.pose.articulated3d!,
              target.pose.articulated3d!,
            ).worst,
      0,
    );
  }
  get position() {
    return this.index / Math.max(1, this.targets.length - 1);
  }
  reset(reason: string) {
    this.buffer = [];
    this.index = 0;
    this.peak = 0;
    this.travel = 0;
    this.errors = [];
    this.alignmentOrigin = null;
    this.holdStart = null;
    this.reason = reason;
    this.restarts++;
  }
  hold(id: "start" | "completion", time: number, compatible: boolean) {
    const anchor = this.reference.anchors.find((a) => a.id === id);
    const dwell = anchor?.holdSource === "teacher_requested" ? anchor.holdMs : 0;
    if (!compatible) {
      this.holdStart = null;
      return false;
    }
    this.holdStart ??= time;
    return time - this.holdStart >= dwell;
  }
  remember(index: number, error: AlignedError) {
    if (!this.errors[index] || error.distance < this.errors[index]!.distance)
      this.errors[index] = error;
  }
  update(pose: NormalizedPose): boolean {
    const time = pose.timestampMs;
    if (!usableArticulated(pose.articulated3d)) {
      if (this.lastMs !== null && time - this.lastMs > 1000 && this.buffer.length)
        this.reset("tracking_loss_restart");
      this.reason = "tracking_invalid";
      return false;
    }
    if (this.lastMs !== null && (time <= this.lastMs || time - this.lastMs > 1000))
      this.reset("tracking_gap_restart");
    this.lastMs = time;
    const start = this.targets[0]!.pose.articulated3d!;
    if (!this.buffer.length) {
      const error = articulatedDistance(pose.articulated3d, start);
      this.distance = error.distance;
      const startsSequence =
        this.canonical.kind !== "sequence" ||
        error.distance <=
          articulatedDistance(pose.articulated3d, this.targets.at(-1)!.pose.articulated3d!)
            .distance +
            1e-8;
      if (this.hold("start", time, error.distance <= this.tolerance && startsSequence)) {
        this.buffer = [pose];
        this.errors = [error];
        this.alignmentOrigin = pose;
        this.holdStart = null;
        this.reason = "start_compatible";
      }
      return false;
    }
    if (time - this.buffer[0]!.timestampMs > 60000) {
      this.reset("bounded_candidate_timeout");
      return false;
    }
    const previous = this.buffer.at(-1)!;
    const step = articulatedDistance(previous.articulated3d!, pose.articulated3d);
    if (!Number.isFinite(step.distance)) {
      this.reason = "insufficient_common_geometry";
      return false;
    }
    if (step.distance > this.tolerance * 2) {
      this.reset("disconnected_observation_restart");
      return false;
    }
    const moving = step.worst > 1e-7;
    if (moving) {
      this.peak = Math.max(
        this.peak,
        articulatedDistance(this.buffer[0]!.articulated3d!, pose.articulated3d).worst,
      );
      this.travel += step.worst;
      this.buffer = compactExecution([...this.buffer, pose]);
    }
    const current = articulatedDistance(
      pose.articulated3d,
      this.targets[this.index]!.pose.articulated3d!,
    );
    this.distance = current.distance;
    this.remember(this.index, current);
    let best = this.index,
      bestError = current;
    let intermediate = { index: best, error: bestError };
    if (moving) {
      for (
        let i = this.index + 1;
        i <= Math.min(this.targets.length - 1, this.index + MAX_FORWARD_TARGETS);
        i++
      ) {
        const target = this.targets[i]!.pose.articulated3d!;
        const error = articulatedDistance(pose.articulated3d, target);
        if (error.distance > this.tolerance) break;
        if (
          !sameMotionDirection(start, target, this.buffer[0]!.articulated3d!, pose.articulated3d) ||
          // Use accumulated local displacement, not the sign of one noisy frame derivative.
          !sameMotionDirection(
            this.targets[this.index]!.pose.articulated3d!,
            target,
            this.alignmentOrigin!.articulated3d!,
            pose.articulated3d,
          )
        )
          break;
        if (error.distance < bestError.distance - 1e-8) {
          best = i;
          bestError = error;
          if (i < this.targets.length - 1) intermediate = { index: best, error: bestError };
        }
      }
    }
    const meaningful =
      this.buffer.length >= 3 &&
      this.peak >=
        Math.max(this.tolerance / 2, (this.reference.articulatedEvidence?.excursion ?? 0) / 2) &&
      this.travel >= this.targetArc / 2;
    const last = this.targets.length - 1;
    const terminal = articulatedDistance(
      pose.articulated3d,
      this.targets[last]!.pose.articulated3d!,
    );
    // The terminal is a local completion region, not the globally nearest pose in a looping source.
    if (
      this.index >= last - 1 &&
      meaningful &&
      terminal.distance <= this.tolerance &&
      sameMotionDirection(
        this.targets[this.index]!.pose.articulated3d!,
        this.targets[last]!.pose.articulated3d!,
        this.alignmentOrigin!.articulated3d!,
        pose.articulated3d,
      ) &&
      sameMotionDirection(
        start,
        this.targets[last]!.pose.articulated3d!,
        this.buffer[0]!.articulated3d!,
        pose.articulated3d,
      )
    ) {
      best = last;
      bestError = terminal;
    }
    if (
      best === last &&
      (!meaningful || !this.hold("completion", time, terminal.distance <= this.tolerance))
    ) {
      best = intermediate.index;
      bestError = intermediate.error;
    } else if (best !== last) this.holdStart = null;
    for (let i = this.index + 1; i <= best; i++)
      this.remember(
        i,
        articulatedDistance(pose.articulated3d, this.targets[i]!.pose.articulated3d!),
      );
    if (best > this.index) {
      this.index = best;
      this.alignmentOrigin = pose;
      this.distance = bestError.distance;
      this.reason = "ordered_target_reached";
    } else this.reason = "awaiting_ordered_target";
    this.maximum = Math.max(this.maximum, this.position);
    if (this.index !== last) {
      if (
        this.index === 0 &&
        this.peak >= this.tolerance / 2 &&
        current.distance <= this.errors[0]!.distance + this.tolerance / 32
      ) {
        this.reset("incomplete_return_to_start");
        this.buffer = [pose];
        this.errors = [current];
        this.alignmentOrigin = pose;
      }
      return false;
    }
    this.evaluationStartMs = this.buffer[0]!.timestampMs;
    this.lastScore = scoreAlignedTargets(this.errors);
    this.reason = "ordered_movement_completed";
    return true;
  }
}

/** One ordered target model for progress, ghost, coaching, completion and quality. */
export class ArticulatedProgressTracker {
  readonly candidates: Candidate[];
  readonly targets;
  private active: Candidate;
  private completed = false;
  private closed = false;
  private alignmentMs = 0;
  private completionReference: string | undefined;
  private completionQuality: number | null = null;
  lastSimilarity = 0;
  readonly evaluations: Array<Record<string, unknown>> = [];
  constructor(
    readonly canonical: CanonicalMovement,
    difficulty = 75,
  ) {
    if (canonical.representation !== ARTICULATED_REPRESENTATION)
      throw new Error("Articulated representation required");
    const tolerance = canonical.articulatedTolerance ?? ARTICULATED_TOLERANCE;
    this.candidates = canonical
      .references!.filter((r) => r.teacherConfirmed && r.alignmentEligible)
      .map((r) => new Candidate(r, canonical, difficulty, tolerance));
    if (!this.candidates.length || this.candidates.some((c) => c.targets.length < 3))
      throw new Error("No coherent articulated reference");
    this.active = this.candidates[0]!;
    this.targets = [...this.active.targets];
  }
  update(pose: NormalizedPose): ProgressTrackerEvent | null {
    if (this.closed || this.completed) return null;
    if (
      pose.body3d ||
      pose.bodySkeleton ||
      (pose.articulated3d && pose.articulated3d.representation !== ARTICULATED_REPRESENTATION)
    )
      throw new Error("Mixed articulated learner geometry");
    const start = performance.now(),
      before = this.active.index;
    let success: Candidate | undefined;
    for (const candidate of this.candidates) {
      if (!candidate.update(pose)) continue;
      this.evaluations.push({
        startMs: candidate.evaluationStartMs,
        endMs: pose.timestampMs,
        referenceId: candidate.reference.demonstrationId,
        ...candidate.lastScore,
        completed: true,
        accepted: true,
        maximumLiveProgress: 100,
      });
      if (!success || candidate.lastScore!.distance < success.lastScore!.distance)
        success = candidate;
    }
    if (this.evaluations.length > 100) this.evaluations.splice(0, this.evaluations.length - 100);
    this.active =
      success ??
      [...this.candidates].sort((a, b) => b.position - a.position || a.distance - b.distance)[0]!;
    this.lastSimilarity = this.active.buffer.length
      ? scoreAlignedTargets(this.active.errors).similarity
      : 0;
    this.targets.splice(0, this.targets.length, ...this.active.targets);
    this.alignmentMs = performance.now() - start;
    if (success) {
      this.completionReference = success.reference.demonstrationId;
      this.completionQuality = success.lastScore!.qualityPercent;
      if (this.canonical.kind === "sequence") this.completed = true;
      else this.candidates.forEach((c) => c.reset("cycle_reset"));
      return { type: this.canonical.kind === "sequence" ? "SEQUENCE_COMPLETE" : "REP_SUCCESS" };
    }
    return this.active.index > before
      ? {
          type: "CHECKPOINT_PASSED",
          index: this.getExpectedIndex(),
          progress: this.active.position * 100,
          phase: "sequence",
        }
      : { type: "MISMATCH", index: this.getExpectedIndex(), similarity: this.lastSimilarity };
  }
  getExpectedIndex() {
    return this.active.index;
  }
  getGhostTarget() {
    return this.targets[this.active.index]!;
  }
  diagnostics() {
    return {
      furthestProgressPercent: Math.max(...this.candidates.map((c) => c.maximum * 100)),
      currentProgressPercent: this.active.position * 100,
      currentPhase: "sequence",
      referenceId: this.active.reference.demonstrationId,
      completionReferenceId: this.completionReference,
      qualityPercent: this.active.buffer.length ? this.lastSimilarity * 100 : null,
      completionQualityPercent: this.completionQuality,
      lastSatisfiedAnchor: this.completed
        ? "completion"
        : this.active.buffer.length
          ? "start"
          : null,
      runtimeTargetIndex: this.getExpectedIndex(),
      runtimeTargetCount: this.targets.length,
      reason: this.active.reason,
      localDistance: Number.isFinite(this.active.distance) ? this.active.distance : null,
      normalizedDtwDistance: null,
      alignmentMethod: "ordered_targets",
      alignmentMs: this.alignmentMs,
      completedCandidates: this.evaluations,
      candidates: this.candidates.map((c) => ({
        referenceId: c.reference.demonstrationId,
        progress: c.position * 100,
        maximum: c.maximum * 100,
        reason: c.reason,
        restarts: c.restarts,
        bufferSamples: c.buffer.length,
      })),
    };
  }
  finish() {
    this.closed = true;
    return this.completed
      ? "sequence_complete"
      : this.candidates.some((c) => c.buffer.length)
        ? "incomplete_candidate"
        : "awaiting_start";
  }
}
