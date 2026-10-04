import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PoseSegmenter } from "../../src/frontend/pose/PoseSegmenter";
import { buildCanonicalMovement } from "../../src/frontend/lesson/CanonicalMovementBuilder";
import { CheckpointTracker } from "../../src/frontend/learn/CheckpointTracker";
import { normalizePose } from "../../src/frontend/pose/PoseNormalizer";
import type { CanonicalCheckpoint, NormalizedPose, PoseFrame } from "../../src/frontend/pose/pose.types";

function load(file: string): PoseFrame[] {
  return (
    JSON.parse(readFileSync(path.resolve(`fixtures/motion-cycle-a/${file}`), "utf8")) as {
      frames: PoseFrame[];
    }
  ).frames;
}

function buildCheckpoints() {
  const frames = load("teacher.pose.json");
  const segmenter = new PoseSegmenter();
  segmenter.captureReference(frames.slice(0, 3));
  const demos = [];
  for (const frame of frames) {
    for (const event of segmenter.update(frame)) {
      demos.push({
        ...event.demonstration,
        classification: "good" as const,
        teacherConfirmed: true,
      });
    }
  }
  return buildCanonicalMovement(demos).checkpoints;
}

function syntheticCheckpoints(): CanonicalCheckpoint[] {
  const progresses: Array<{ progress: 0 | 25 | 50 | 75 | 100; phase: "outbound" | "apex" | "return" }> = [
    { progress: 0, phase: "outbound" },
    { progress: 25, phase: "outbound" },
    { progress: 50, phase: "outbound" },
    { progress: 75, phase: "outbound" },
    { progress: 100, phase: "apex" },
    { progress: 75, phase: "return" },
    { progress: 50, phase: "return" },
    { progress: 25, phase: "return" },
    { progress: 0, phase: "return" },
  ];
  return progresses.map((item, index) => ({
    index,
    progress: item.progress,
    phase: item.phase,
    pose: {
      landmarks: Array.from({ length: 33 }, (_, i) => ({
        x: i === 15 || i === 16 ? item.progress / 100 : 0,
        y: 0,
        z: 0,
        visibility: 1,
      })),
    },
  }));
}

function poseAt(progress: number, timestampMs: number): NormalizedPose {
  return {
    timestampMs,
    landmarks: Array.from({ length: 33 }, (_, i) => ({
      x: i === 15 || i === 16 ? progress / 100 : 0,
      y: 0,
      z: 0,
      visibility: 1,
    })),
  };
}

describe("CheckpointTracker", () => {
  it("emits REP_SUCCESS for student-good sequential traversal", () => {
    const checkpoints = buildCheckpoints();
    const tracker = new CheckpointTracker(checkpoints, {
      leniency: 0.45,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    let success = 0;
    for (const frame of load("student-good.pose.json")) {
      const event = tracker.update(normalizePose(frame), true);
      if (event?.type === "REP_SUCCESS") success += 1;
    }
    expect(success).toBe(1);
  });

  it("does not emit REP_SUCCESS for student-bad skipping behavior", () => {
    const checkpoints = buildCheckpoints();
    const tracker = new CheckpointTracker(checkpoints, {
      leniency: 0.45,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    let success = 0;
    for (const frame of load("student-bad.pose.json")) {
      const event = tracker.update(normalizePose(frame), true);
      if (event?.type === "REP_SUCCESS") success += 1;
    }
    expect(success).toBe(0);
  });

  it("never succeeds when tracking is invalid even at leniency 1", () => {
    const checkpoints = buildCheckpoints();
    const tracker = new CheckpointTracker(checkpoints, {
      leniency: 1,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    let success = 0;
    for (const frame of load("student-good.pose.json")) {
      const event = tracker.update(normalizePose(frame), false);
      if (event?.type === "REP_SUCCESS") success += 1;
    }
    expect(success).toBe(0);
  });

  it("succeeds only after 0-25-50-75-100-75-50-25-0", () => {
    const tracker = new CheckpointTracker(syntheticCheckpoints(), {
      leniency: 0.45,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    const sequence = [0, 0, 25, 25, 50, 50, 75, 75, 100, 100, 75, 75, 50, 50, 25, 25, 0, 0];
    let success = 0;
    let t = 0;
    for (const progress of sequence) {
      const event = tracker.update(poseAt(progress, t), true);
      t += 40;
      if (event?.type === "REP_SUCCESS") success += 1;
    }
    expect(success).toBe(1);
  });

  it("ignores monocular depth noise between teacher and student sessions", () => {
    const tracker = new CheckpointTracker(syntheticCheckpoints(), {
      leniency: 0.25,
      minimumVisibility: 0.5,
      checkpointHoldMs: 0,
    });
    const sequence = [0, 0, 25, 25, 50, 50, 75, 75, 100, 100, 75, 75, 50, 50, 25, 25, 0, 0];
    let success = 0;
    sequence.forEach((progress, i) => {
      const pose = poseAt(progress, i * 40);
      pose.landmarks = pose.landmarks.map((l, j) => ({ ...l, z: (j % 2 === 0 ? 2.5 : -2.5) * ((i % 3) - 1) }));
      if (tracker.update(pose, true)?.type === "REP_SUCCESS") success += 1;
    });
    expect(success).toBe(1);
  });

  it("fails if the trajectory reaches 100 and stops", () => {
    const tracker = new CheckpointTracker(syntheticCheckpoints(), {
      leniency: 0.45,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    let success = 0;
    let t = 0;
    for (const progress of [0, 0, 25, 25, 50, 50, 75, 75, 100, 100, 100, 100]) {
      const event = tracker.update(poseAt(progress, t), true);
      t += 40;
      if (event?.type === "REP_SUCCESS") success += 1;
    }
    expect(success).toBe(0);
  });

  it("fails when later checkpoints are skipped", () => {
    const tracker = new CheckpointTracker(syntheticCheckpoints(), {
      leniency: 0.45,
      minimumVisibility: 0.2,
      checkpointHoldMs: 0,
    });
    let success = 0;
    const event = tracker.update(poseAt(100, 0), true);
    if (event?.type === "REP_SUCCESS") success += 1;
    expect(success).toBe(0);
  });
});
