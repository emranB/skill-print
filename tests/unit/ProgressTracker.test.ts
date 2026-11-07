import { describe, expect, it } from "vitest";
import { buildRuntimeTargets, difficultyToTrajectoryInterval, resolveCanonical } from "../../src/frontend/lesson/RuntimeTargets";
import { FORWARD_WINDOW_PROGRESS, ProgressTracker } from "../../src/frontend/learn/ProgressTracker";
import type { CanonicalMovement, NormalizedPose } from "../../src/frontend/pose/pose.types";

function pose(x: number, timestampMs = 0): NormalizedPose {
  return { timestampMs, landmarks: Array.from({ length: 33 }, () => ({ x, y: 0, z: 0, visibility: 1 })) };
}
function canonical(kind: "cycle" | "sequence"): CanonicalMovement {
  const samples = Array.from({ length: 201 }, (_, i) => ({ progress01: i / 200,
    phase: kind === "sequence" ? "sequence" as const : i < 100 ? "outbound" as const : i === 100 ? "apex" as const : "return" as const,
    pose: pose(kind === "sequence" ? i / 200 : i <= 100 ? i / 100 : 2 - i / 100) }));
  return { schemaVersion: 2, kind, samples, checkpoints: [], anchors: (kind === "cycle" ? [0, 100, 200] : [0, 200]).map((i) => ({ ...samples[i]!, id: i === 0 ? "start" as const : i === 200 ? "completion" as const : "apex" as const, holdMs: 150 })) };
}
function tracker(kind: "cycle" | "sequence", difficulty = 100) {
  const c = canonical(kind);
  return new ProgressTracker(c, buildRuntimeTargets(c, difficulty), { leniency: 0.25, minimumVisibility: 0.5 });
}
describe("canonical runtime targets", () => {
  it("uses one clamped difficulty formula", () => {
    expect([1, 20, 50, 75, 80, 99, 100].map(difficultyToTrajectoryInterval)).toEqual([99, 80, 50, 25, 20, 1, 1]);
    expect(difficultyToTrajectoryInterval(NaN)).toBe(25);
  });
  it("includes semantic anchors at every density without mutating source", () => {
    const c = canonical("cycle");
    const before = JSON.stringify(c);
    expect([1, 20, 50, 75, 80, 99, 100].map((d) => buildRuntimeTargets(c, d).length)).toEqual([5, 5, 5, 9, 11, 201, 201]);
    for (const d of [1, 100]) expect(buildRuntimeTargets(c, d).filter((t) => t.anchor).map((t) => t.anchor!.id)).toEqual(["start", "apex", "completion"]);
    expect(JSON.stringify(c)).toBe(before);
  });
  it("upgrades nine legacy checkpoints and missing kind without writing the lesson", () => {
    const old = { checkpoints: Array.from({ length: 9 }, (_, index) => ({ index, progress: 0 as const, phase: "outbound" as const, pose: pose(index) })) };
    expect(resolveCanonical(old).trajectorySource).toBe("legacy_checkpoints");
    expect(resolveCanonical(old).kind).toBe("cycle");
    expect(resolveCanonical(old).samples).toHaveLength(201);
    expect("samples" in old).toBe(false);
  });
  it("prefers dense source, then demonstrated trajectories, before checkpoint interpolation", () => {
    const c = canonical("cycle");
    const demonstration = { id: "legacy-demo", startMs: 0, apexMs: 500, endMs: 1000,
      classification: "good" as const, teacherConfirmed: true, trajectory: [pose(0, 0), pose(1, 500), pose(0, 1000)] };
    expect(resolveCanonical(c, [demonstration]).samples).toBe(c.samples);
    const fallback = resolveCanonical({ checkpoints: [] }, [demonstration]);
    expect(fallback.trajectorySource).toBe("demonstration_trajectories");
    expect(fallback.samples!.length).toBeGreaterThan(9);
    expect(fallback.anchors!.map((a) => a.id)).toEqual(["start", "apex", "completion"]);
  });
});
describe("ProgressTracker", () => {
  it("rejects a degenerate constant canonical path rather than counting idle poses", () => {
    const c = canonical("cycle");
    c.samples = c.samples!.map((s) => ({ ...s, pose: pose(0) }));
    c.anchors = c.anchors!.map((a) => ({ ...a, pose: pose(0) }));
    const t = new ProgressTracker(c, buildRuntimeTargets(c, 100), { leniency: 0.25, minimumVisibility: 0.5 });
    for (let i = 0; i < 100; i++) expect(t.update(pose(0, i * 67), true)?.type).not.toBe("REP_SUCCESS");
    expect(t.diagnostics().reason).toBe("invalid_movement_no_motion");
  });
  it("has a fixed progress window, unrelated to FPS or target count", () => expect(FORWARD_WINDOW_PROGRESS).toBe(0.15));
  it("cannot skip start or cross an unsatisfied apex", () => {
    const t = tracker("cycle");
    let ms = 0;
    for (let i = 0; i < 80; i++) t.update(pose(i < 4 ? 0 : 0.65, ms += 67), true);
    expect(t.diagnostics().lastSatisfiedAnchor).toBe("start");
    expect(t.diagnostics().currentProgressPercent).toBeLessThanOrEqual(50);
    expect(t.finish()).toBe("never_reached_apex");
    for (let i = 0; i < 10; i++) expect(t.update(pose(0, ms += 67), true)?.type).not.toBe("REP_SUCCESS");
  });
  it("does not turn a stationary start pose into repetitions", () => {
    const t = tracker("cycle");
    for (let i = 0; i < 200; i++) expect(t.update(pose(0, i * 67), true)?.type).not.toBe("REP_SUCCESS");
    expect(t.diagnostics().currentProgressPercent).toBe(0);
  });
  it("completes a dense cycle at 15 FPS, holding only semantic anchors", () => {
    const t = tracker("cycle");
    let ms = 0; let success = 0;
    const path = [...Array(4).fill(0), ...Array.from({ length: 31 }, (_, i) => i / 30), ...Array(4).fill(1), ...Array.from({ length: 31 }, (_, i) => 1 - i / 30), ...Array(4).fill(0)] as number[];
    for (const x of path) if (t.update(pose(x, ms += 1000 / 15), true)?.type === "REP_SUCCESS") success++;
    expect(success).toBe(1);
  });
  it("sequence completes once and never wraps or requires an apex", () => {
    const t = tracker("sequence"); let ms = 0; let success = 0;
    for (const x of [...Array(4).fill(0), ...Array.from({ length: 51 }, (_, i) => i / 50), ...Array(4).fill(1)] as number[]) {
      if (t.update(pose(x, ms += 67), true)?.type === "SEQUENCE_COMPLETE") success++;
    }
    for (let i = 0; i < 20; i++) expect(t.update(pose(1, ms += 67), true)).toBeNull();
    expect(success).toBe(1); expect(t.finish()).toBe("sequence_complete");
  });
  it("invalid and discontinuous frames cannot satisfy an anchor hold", () => {
    const t = tracker("sequence");
    t.update(pose(0, 0), true); t.update(pose(0, 100), false); t.update(pose(0, 200), true);
    expect(t.diagnostics().lastSatisfiedAnchor).toBeNull();
    t.update(pose(0, 1000), true);
    expect(t.diagnostics().lastSatisfiedAnchor).toBeNull();
  });
  it("accepts an anchor within tolerance without demanding a noise-free exact pose", () => {
    const t = tracker("sequence"); let ms = 0; let success = 0;
    for (const x of [...Array(4).fill(0), ...Array.from({ length: 46 }, (_, i) => i / 50), ...Array(4).fill(0.9)] as number[]) {
      if (t.update(pose(x, ms += 67), true)?.type === "SEQUENCE_COMPLETE") success++;
    }
    expect(success).toBe(1);
  });
  it("traverses contiguous identical geometry within the local window to completion", () => {
    const c = canonical("sequence");
    c.samples = c.samples!.map((s) => ({ ...s, pose: pose(Math.min(s.progress01 / 0.7, 1)) }));
    c.anchors![1]!.pose = pose(1);
    const t = new ProgressTracker(c, buildRuntimeTargets(c, 100), { leniency: 0.25, minimumVisibility: 0.5 });
    let ms = 0; let count = 0;
    for (const x of [...Array(4).fill(0), ...Array.from({ length: 41 }, (_, i) => i / 40), ...Array(8).fill(1)] as number[]) {
      if (t.update(pose(x, ms += 67), true)?.type === "SEQUENCE_COMPLETE") count++;
    }
    expect(count).toBe(1);
  });
});
