import { comparePose } from "../pose/PoseComparator";
import { poseDistance } from "../pose/PoseDistance";
import { interpolateGeometry, sampleCanonical, type RuntimeTarget } from "../lesson/RuntimeTargets";
import type { CanonicalMovement, NormalizedPose, CanonicalSample } from "../pose/pose.types";

/** Fraction of canonical path, independent of sampling density and camera FPS. */
export const FORWARD_WINDOW_PROGRESS = 0.15;
export const GEOMETRY_NEIGHBORHOOD_RADIUS = 0.25;
const MATCH_IMPROVEMENT = 0.00001;
export const GEOMETRIC_PLATEAU_EPSILON = 1e-6;

export type ProgressTrackerEvent =
  | { type: "CHECKPOINT_PASSED"; index: number; progress: number; phase: string }
  | { type: "REP_SUCCESS" }
  | { type: "SEQUENCE_COMPLETE" }
  | { type: "MISMATCH"; index: number; similarity: number };

export interface ProgressTrackerOptions {
  leniency: number;
  minimumVisibility: number;
  angleWeight?: number;
}

export class ProgressTracker {
  private progress01 = 0;
  private nextAnchor = 0;
  private holdSince: number | null = null;
  private lastTimestamp = -Infinity;
  private finished = false;
  private furthest = 0;
  private lastAnchor: string | null = null;
  private reason = "awaiting_start";
  private previousPose: NormalizedPose | null = null;
  private readonly hasMotion: boolean;
  lastSimilarity = 0;

  constructor(readonly canonical: CanonicalMovement, readonly targets: RuntimeTarget[], private readonly options: ProgressTrackerOptions) {
    const first = canonical.samples?.[0];
    this.hasMotion = Boolean(first && canonical.samples?.some((s) => {
      const distance = poseDistance(first.pose, s.pose, { minimumVisibility: options.minimumVisibility, planar: true, minimumJoints: 4 });
      return Number.isFinite(distance) && distance > GEOMETRIC_PLATEAU_EPSILON;
    }));
  }

  private compare(pose: NormalizedPose, sample: CanonicalSample, valid: boolean) {
    return comparePose(pose, sample.pose, { ...this.options, trackingValid: valid });
  }

  getExpectedIndex(): number {
    const anchor = this.canonical.anchors?.[this.nextAnchor];
    const next = this.targets.find((t) => t.progress01 > this.progress01 + 1e-8 && (!anchor || t.progress01 <= anchor.progress01));
    return next?.index ?? this.targets.findIndex((t) => t.anchor?.id === anchor?.id);
  }

  getGhostTarget(): CanonicalSample | undefined {
    if (this.finished) return this.targets[this.targets.length - 1];
    if (this.nextAnchor === 0) return this.canonical.anchors?.[0];
    return this.targets[this.getExpectedIndex()] ?? this.canonical.anchors?.[this.nextAnchor];
  }

  diagnostics() {
    return { furthestProgressPercent: this.furthest * 100, currentPhase: this.getGhostTarget()?.phase,
      lastSatisfiedAnchor: this.lastAnchor, runtimeTargetIndex: this.getExpectedIndex(), runtimeTargetCount: this.targets.length,
      reason: this.reason, currentProgressPercent: this.progress01 * 100 };
  }

  finish(): string {
    if (this.finished) return "sequence_complete";
    if (this.canonical.kind === "sequence") return "incomplete_sequence";
    return this.nextAnchor <= 1 ? "never_reached_apex" : "incomplete_return";
  }

  update(pose: NormalizedPose, valid: boolean): ProgressTrackerEvent | null {
    if (this.finished || !this.targets.length || pose.timestampMs <= this.lastTimestamp) return null;
    const gap = pose.timestampMs - this.lastTimestamp;
    this.lastTimestamp = pose.timestampMs;
    if (!this.hasMotion) { this.reason = "invalid_movement_no_motion"; return { type: "MISMATCH", index: 0, similarity: 0 }; }
    if (!valid || gap > 500) { this.holdSince = null; this.previousPose = null; }
    if (!valid) { this.reason = "tracking_invalid"; return { type: "MISMATCH", index: this.getExpectedIndex(), similarity: 0 }; }
    const anchors = this.canonical.anchors!;
    const anchor = anchors[this.nextAnchor];
    const samples = this.canonical.samples!;
    if (!anchor) return null;
    const current = sampleCanonical(samples, this.progress01);
    const upper = this.nextAnchor === 0 ? 0 : Math.min(this.progress01 + FORWARD_WINDOW_PROGRESS, anchor.progress01);
    const neighborhood = samples.filter((s) => s.progress01 >= this.progress01 - 1e-8 && s.progress01 <= upper + 1e-8 &&
      poseDistance(current.pose, s.pose, { minimumVisibility: this.options.minimumVisibility, planar: true, minimumJoints: 4 }) <= GEOMETRY_NEIGHBORHOOD_RADIUS);
    let best = current;
    let result = this.compare(pose, best, valid);
    const previous = this.previousPose;
    this.previousPose = pose;
    const supportsPath = (candidate: CanonicalSample) => this.targets
      .filter((t) => !t.anchor && t.progress01 > this.progress01 && t.progress01 < candidate.progress01)
      .every((t) => {
        // A frame may span multiple dense targets only when the observed geometric segment supports them.
        const sweep = previous ? Array.from({ length: 9 }, (_, i) => interpolateGeometry(previous, pose, i / 8)) : [pose];
        return sweep.some((s) => this.compare({ ...s, timestampMs: pose.timestampMs }, t, valid).passed);
      });
    for (const candidate of neighborhood) {
      const compared = this.compare(pose, candidate, valid);
      const identicalPlateau = Math.abs(compared.similarity - result.similarity) <= MATCH_IMPROVEMENT &&
        poseDistance(best.pose, candidate.pose, { minimumVisibility: this.options.minimumVisibility, planar: true, minimumJoints: 4 }) <= GEOMETRIC_PLATEAU_EPSILON;
      if ((compared.similarity > result.similarity + MATCH_IMPROVEMENT || identicalPlateau) && supportsPath(candidate)) { best = candidate; result = compared; }
    }
    this.lastSimilarity = result.similarity;
    if (result.passed && best.progress01 > this.progress01) {
      this.progress01 = best.progress01;
      this.furthest = Math.max(this.furthest, this.progress01);
      this.reason = "local_geometry_match";
    }
    const anchorResult = this.compare(pose, anchor, valid);
    // Anchors require local path access, geometric tolerance and a continuous hold.
    const atAnchor = this.nextAnchor === 0 || (anchor.progress01 <= upper + 1e-8 &&
      poseDistance(current.pose, anchor.pose, { minimumVisibility: this.options.minimumVisibility, planar: true, minimumJoints: 4 }) <= GEOMETRY_NEIGHBORHOOD_RADIUS);
    if (atAnchor && anchorResult.passed) {
      if (this.holdSince === null) this.holdSince = pose.timestampMs;
      this.reason = "anchor_hold";
      if (pose.timestampMs - this.holdSince >= anchor.holdMs) {
        this.progress01 = anchor.progress01;
        this.furthest = Math.max(this.furthest, this.progress01);
        this.lastAnchor = anchor.id;
        this.nextAnchor += 1;
        this.holdSince = null;
        this.reason = "anchor_satisfied";
        if (anchor.id === "completion") {
          if (this.canonical.kind === "sequence") { this.finished = true; return { type: "SEQUENCE_COMPLETE" }; }
          this.progress01 = 0; this.nextAnchor = 0;
          return { type: "REP_SUCCESS" };
        }
      }
    } else this.holdSince = null;
    if (this.progress01 > current.progress01) return { type: "CHECKPOINT_PASSED", index: this.getExpectedIndex(), progress: this.progress01 * 100, phase: best.phase };
    if (!result.passed) { this.reason = "geometry_mismatch"; return { type: "MISMATCH", index: this.getExpectedIndex(), similarity: result.similarity }; }
    return null;
  }
}
