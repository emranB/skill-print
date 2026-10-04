import { createId } from "../../shared/utils/id";
import { poseDistance } from "./PoseDistance";
import { normalizePose } from "./PoseNormalizer";
import type {
  Demonstration,
  NormalizedPose,
  PoseFrame,
} from "./pose.types";

export type SegmentationPhase =
  | "NEAR_START"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETE";

export interface SegmentationEvent {
  type: "CYCLE_COMPLETE" | "CYCLE_FRAGMENT";
  demonstration: Demonstration;
}

export interface PoseSegmenterOptions {
  enterThreshold?: number;
  exitThreshold?: number;
  pauseSpeedThreshold?: number;
  returnDwellMs?: number;
  minExcursion?: number;
  minCycleMs?: number;
  minimumVisibility?: number;
  reanchorStableMs?: number;
  /** Compare poses in the image plane only. */
  planar?: boolean;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

/**
 * Generic movement cycle segmentation.
 * NEAR_START → ACTIVE → PAUSED/ACTIVE → COMPLETE near start with dwell.
 *
 * Far geometric plateau (low variance, large mean distance from current
 * reference, held for reanchorStableMs) is treated as a new rest pose.
 * That covers viewpoint jumps and stance changes without camera-side knowledge.
 */
export class PoseSegmenter {
  private reference: NormalizedPose | null = null;
  private phase: SegmentationPhase = "NEAR_START";
  private cycleStart: NormalizedPose | null = null;
  private trajectory: NormalizedPose[] = [];
  private maxDistance = 0;
  private apexPose: NormalizedPose | null = null;
  private nearStartSince: number | null = null;
  private plateauSince: number | null = null;
  private recentDistances: number[] = [];
  private lastPose: NormalizedPose | null = null;
  private readonly enterThreshold: number;
  private readonly exitThreshold: number;
  private readonly pauseSpeedThreshold: number;
  private readonly returnDwellMs: number;
  private readonly minExcursion: number;
  private readonly minCycleMs: number;
  private readonly minimumVisibility: number;
  private readonly reanchorStableMs: number;
  private readonly planar: boolean;

  constructor(options: PoseSegmenterOptions = {}) {
    this.planar = options.planar ?? false;
    this.enterThreshold = options.enterThreshold ?? 0.16;
    this.exitThreshold = options.exitThreshold ?? 0.14;
    this.pauseSpeedThreshold = options.pauseSpeedThreshold ?? 0.45;
    this.returnDwellMs = options.returnDwellMs ?? 280;
    this.minExcursion = options.minExcursion ?? 0.2;
    this.minCycleMs = options.minCycleMs ?? 250;
    this.minimumVisibility = options.minimumVisibility ?? 0.35;
    this.reanchorStableMs = options.reanchorStableMs ?? 2800;
  }

  captureReference(frames: PoseFrame[]): NormalizedPose {
    if (frames.length === 0) {
      throw new Error("Cannot capture reference from empty frames");
    }
    const normalized = frames.map((f) => normalizePose(f, 0));
    const mid = normalized[Math.floor(normalized.length / 2)]!;
    this.reference = mid;
    this.resetCycleState();
    this.phase = "NEAR_START";
    return mid;
  }

  setReference(pose: NormalizedPose): void {
    this.reference = pose;
    this.resetCycleState();
    this.phase = "NEAR_START";
  }

  getPhase(): SegmentationPhase {
    return this.phase;
  }

  update(frame: PoseFrame): SegmentationEvent[] {
    if (!this.reference) return [];
    const pose = normalizePose(frame, 0);
    const distance = poseDistance(pose, this.reference, {
      minimumVisibility: this.minimumVisibility,
      planar: this.planar,
    });
    if (!Number.isFinite(distance)) {
      return [];
    }

    this.recentDistances.push(distance);
    if (this.recentDistances.length > 12) this.recentDistances.shift();

    const events: SegmentationEvent[] = [];
    const dtSec = this.lastPose
      ? Math.max(1 / 120, (pose.timestampMs - this.lastPose.timestampMs) / 1000)
      : 1;
    const step = this.lastPose
      ? poseDistance(pose, this.lastPose, {
          minimumVisibility: this.minimumVisibility,
          planar: this.planar,
        })
      : 0;
    const speed = Number.isFinite(step) ? step / dtSec : 0;

    if (this.phase === "NEAR_START") {
      if (distance >= this.enterThreshold) {
        this.phase = "ACTIVE";
        this.cycleStart = this.reference;
        this.trajectory = this.lastPose ? [this.lastPose, pose] : [pose];
        this.maxDistance = distance;
        this.apexPose = pose;
        this.nearStartSince = null;
        this.plateauSince = null;
      }
    } else if (this.phase === "ACTIVE" || this.phase === "PAUSED") {
      this.trajectory.push(pose);
      if (distance > this.maxDistance) {
        this.maxDistance = distance;
        this.apexPose = pose;
      }

      if (this.phase === "ACTIVE" && speed < this.pauseSpeedThreshold && distance > this.exitThreshold) {
        this.phase = "PAUSED";
      } else if (this.phase === "PAUSED" && speed >= this.pauseSpeedThreshold) {
        this.phase = "ACTIVE";
      }

      if (distance <= this.exitThreshold && this.maxDistance >= this.minExcursion) {
        if (this.nearStartSince === null) this.nearStartSince = pose.timestampMs;
        if (pose.timestampMs - this.nearStartSince >= this.returnDwellMs) {
          const start = this.cycleStart ?? this.reference;
          const apex = this.apexPose!;
          const duration = pose.timestampMs - (this.trajectory[0]?.timestampMs ?? start.timestampMs);
          if (duration >= this.minCycleMs) {
            events.push({
              type: "CYCLE_COMPLETE",
              demonstration: {
                id: createId(),
                startMs: this.trajectory[0]?.timestampMs ?? start.timestampMs,
                apexMs: apex.timestampMs,
                endMs: pose.timestampMs,
                classification: "unknown",
                teacherConfirmed: false,
                trajectory: [...this.trajectory],
              },
            });
          }
          this.resetCycleState();
          this.phase = "NEAR_START";
          this.lastPose = pose;
          return events;
        }
      } else {
        this.nearStartSince = null;
      }

      // Far geometric plateau => new rest/start pose (viewpoint or stance change).
      // Require a large mean distance so ordinary mid-rep pauses do not re-anchor.
      const meanDistance =
        this.recentDistances.reduce((a, b) => a + b, 0) /
        Math.max(1, this.recentDistances.length);
      const farPlateau =
        this.recentDistances.length >= 10 &&
        variance(this.recentDistances) < 0.03 &&
        meanDistance > 0.85;

      if (farPlateau) {
        if (this.plateauSince === null) this.plateauSince = pose.timestampMs;
        if (pose.timestampMs - this.plateauSince >= this.reanchorStableMs) {
          if (this.maxDistance >= this.minExcursion * 0.5 && this.cycleStart) {
            events.push({
              type: "CYCLE_FRAGMENT",
              demonstration: {
                id: createId(),
                startMs: this.trajectory[0]?.timestampMs ?? pose.timestampMs,
                apexMs: (this.apexPose ?? pose).timestampMs,
                endMs: pose.timestampMs,
                classification: "fragment",
                teacherConfirmed: false,
                trajectory: [...this.trajectory],
              },
            });
          }
          this.reference = pose;
          this.resetCycleState();
          this.phase = "NEAR_START";
        }
      } else {
        this.plateauSince = null;
      }
    }

    this.lastPose = pose;
    return events;
  }

  /** Close an excursion that is still open when the input ends. */
  flush(): SegmentationEvent[] {
    const open = this.phase === "ACTIVE" || this.phase === "PAUSED";
    const events: SegmentationEvent[] = [];
    if (open && this.maxDistance >= this.minExcursion && this.trajectory.length > 1) {
      events.push({
        type: "CYCLE_FRAGMENT",
        demonstration: {
          id: createId(),
          startMs: this.trajectory[0]!.timestampMs,
          apexMs: (this.apexPose ?? this.trajectory[0]!).timestampMs,
          endMs: this.trajectory[this.trajectory.length - 1]!.timestampMs,
          classification: "fragment",
          teacherConfirmed: false,
          trajectory: [...this.trajectory],
        },
      });
    }
    this.resetCycleState();
    this.phase = "NEAR_START";
    return events;
  }

  private resetCycleState(): void {
    this.cycleStart = null;
    this.trajectory = [];
    this.maxDistance = 0;
    this.apexPose = null;
    this.nearStartSince = null;
    this.plateauSince = null;
    this.recentDistances = [];
  }
}
