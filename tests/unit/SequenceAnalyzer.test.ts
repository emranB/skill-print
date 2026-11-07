import { describe, expect, it } from "vitest";
import { detectSequence } from "../../src/frontend/analyze/SequenceAnalyzer";
import { buildCanonicalMovement } from "../../src/frontend/lesson/CanonicalMovementBuilder";
import { buildRuntimeTargets } from "../../src/frontend/lesson/RuntimeTargets";
import { syntheticReferenceFrame } from "../../src/frontend/teach/syntheticPose";

describe("sequence compilation", () => {
  it("does not count a detection gap as a consecutive stable window", () => {
    const frames = [0, 67, 800, 867].map((timestampMs) => ({ ...syntheticReferenceFrame(), timestampMs }));
    expect(detectSequence(frames)).toHaveLength(0);
  });
  it("does not fabricate apex or a return to rest", () => {
    const frames = Array.from({ length: 40 }, (_, i) => {
      const frame = syntheticReferenceFrame(); frame.timestampMs = i * 67;
      if (i > 10) frame.landmarks[15]!.y += (i - 10) / 40;
      return frame;
    });
    const demos = detectSequence(frames);
    expect(demos).toHaveLength(1); expect(demos[0]!.apexMs).toBeUndefined();
    const c = buildCanonicalMovement(demos.map((d) => ({ ...d, classification: "good" as const, teacherConfirmed: true })), "sequence");
    expect(c.anchors!.map((a) => a.id)).toEqual(["start", "completion"]);
    expect(c.samples!.every((s) => s.phase === "sequence")).toBe(true);
    expect(c.samples![0]!.pose).not.toEqual(c.samples!.at(-1)!.pose);
    expect([1, 20, 50, 75, 80, 99, 100].map((d) => buildRuntimeTargets(c, d).length)).toEqual([3, 3, 3, 5, 6, 101, 101]);
  });
  it("requires consecutive usable calibration frames", () => {
    const frames = Array.from({ length: 10 }, (_, i) => ({ ...syntheticReferenceFrame(), timestampMs: i * 100 }));
    frames[4]!.landmarks = [];
    expect(detectSequence(frames)).toHaveLength(0);
  });
});
