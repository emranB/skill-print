import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PoseSegmenter } from "../../src/frontend/pose/PoseSegmenter";
import { buildCanonicalMovement } from "../../src/frontend/lesson/CanonicalMovementBuilder";
import type { PoseFrame } from "../../src/frontend/pose/pose.types";

describe("CanonicalMovementBuilder", () => {
  it("builds 9 checkpoints without inventing timestamps", () => {
    const frames = (
      JSON.parse(
        readFileSync(path.resolve("fixtures/motion-cycle-a/teacher.pose.json"), "utf8"),
      ) as { frames: PoseFrame[] }
    ).frames;
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
    const movement = buildCanonicalMovement(demos);
    expect(movement.checkpoints).toHaveLength(9);
    expect(movement.checkpoints.map((c) => c.progress)).toEqual([
      0, 25, 50, 75, 100, 75, 50, 25, 0,
    ]);
    for (const cp of movement.checkpoints) {
      expect("timestampMs" in cp.pose).toBe(false);
      expect(cp.pose.landmarks.length).toBeGreaterThan(0);
    }
  });
});
