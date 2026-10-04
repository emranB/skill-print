import type { NormalizedPose } from "../pose/pose.types";

/** Lightweight buffer of recent student poses for coaching context. */
export class TrajectoryTracker {
  private poses: NormalizedPose[] = [];

  constructor(private readonly maxFrames = 90) {}

  add(pose: NormalizedPose): void {
    this.poses.push(pose);
    if (this.poses.length > this.maxFrames) {
      this.poses.shift();
    }
  }

  clear(): void {
    this.poses = [];
  }

  recent(): NormalizedPose[] {
    return [...this.poses];
  }
}
