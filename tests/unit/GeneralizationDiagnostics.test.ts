import { describe, expect, it } from "vitest";
import { jointErrors, diagnosticSimilarity, mirrorPose, orderedPrefix, instrumentReplay } from "../../src/scripts/level-b/generalizationDiagnostics";
import { poseDistance } from "../../src/frontend/pose/PoseDistance";
import { comparePose } from "../../src/frontend/pose/PoseComparator";
import { normalizePose } from "../../src/frontend/pose/PoseNormalizer";
import { ProgressTracker } from "../../src/frontend/learn/ProgressTracker";
import { buildRuntimeTargets } from "../../src/frontend/lesson/RuntimeTargets";
import type { CanonicalMovement, NormalizedPoseGeometry, PoseFrame } from "../../src/frontend/pose/pose.types";

function geometry(x = 0): NormalizedPoseGeometry {
  return { landmarks: Array.from({ length: 33 }, (_, i) => ({ x: x + i / 100, y: i / 50, z: i / 200, visibility: 1 })) };
}
function frame(bend: number, timestampMs: number): PoseFrame {
  const landmarks = geometry().landmarks.map((p) => ({ ...p }));
  for (const [index, x, y] of [[11, 0.4, 0.2], [12, 0.6, 0.2], [23, 0.45, 0.5], [24, 0.55, 0.5], [25, 0.4 + bend * 0.1, 0.7 - bend * 0.15], [26, 0.6 - bend * 0.1, 0.7 - bend * 0.15]]) {
    landmarks[index!] = { x: x!, y: y!, z: 0, visibility: 1 };
  }
  return { timestampMs, landmarks, worldLandmarks: [] };
}

describe("offline generalization diagnostics", () => {
  it("accounts for the exact production distance using only eligible joints", () => {
    const a = geometry(0.2); const b = geometry();
    a.landmarks[15]!.visibility = 0.1;
    const errors = jointErrors(a, b, 0.65);
    expect(errors.find((e) => e.index === 15)!.scored).toBe(false);
    expect(errors.find((e) => e.index === 15)!.meanDistanceContribution).toBe(0);
    expect(errors.reduce((sum, e) => sum + e.meanDistanceContribution, 0)).toBeCloseTo(poseDistance(a, b, { minimumVisibility: 0.65, planar: true }), 14);
    expect(errors.reduce((sum, e) => sum + e.similarityLossContribution, 0)).toBeCloseTo(0.2 / 1.25, 14);
  });
  it("keeps baseline diagnostic similarity identical to the frozen comparator", () => {
    const a = geometry(0.3); const b = geometry();
    expect(diagnosticSimilarity(a, b, 0.65, "existing_12_joint_xy")).toBe(comparePose(a, b, { minimumVisibility: 0.65, leniency: 0.25, angleWeight: 0, trackingValid: true }).similarity);
  });
  it("never labels a missing semantic apex as full ordered coverage", () => {
    const matrix = [[0.9, 0.8, 0.4, 0.9], [0.9, 0.8, 0.6, 1]];
    expect(orderedPrefix(matrix, 0.75)).toEqual({ lastColumn: 1, witnessRows: [0, 0, -1, -1], complete: false });
  });
  it("does not wrap backwards to an earlier frame for ordered coverage", () => {
    expect(orderedPrefix([[0.1, 0.9], [0.9, 0.1]], 0.75).complete).toBe(false);
    expect(orderedPrefix([[0.9, null], [0.1, 0.9]], 0.75)).toEqual({ lastColumn: 1, witnessRows: [0, 1], complete: true });
  });
  it("exposes permissive same-frame coverage rather than treating it as a repetition", () => {
    expect(orderedPrefix([[1, 1, 1]], 0.75)).toEqual({ lastColumn: 2, witnessRows: [0, 0, 0], complete: true });
  });
  it("mirroring is an involution and does not mutate source geometry", () => {
    const p = geometry(); const before = JSON.stringify(p);
    expect(mirrorPose(mirrorPose(p))).toEqual(p);
    expect(JSON.stringify(p)).toBe(before);
  });
  it("requires reliable angle evidence instead of inventing a missing score", () => {
    const p = geometry(); p.landmarks.forEach((lm) => { lm.visibility = 0.1; });
    expect(diagnosticSimilarity(p, geometry(), 0.65, "normalized_joint_angles")).toBeNull();
  });
  it("observes the actual tracker without changing inputs or replay progress", () => {
    const samples = Array.from({ length: 21 }, (_, i) => ({ progress01: i / 20, phase: i < 10 ? "outbound" as const : i === 10 ? "apex" as const : "return" as const, pose: normalizePose(frame(i <= 10 ? i / 10 : 2 - i / 10, 0)) }));
    const c: CanonicalMovement = { schemaVersion: 2, kind: "cycle", samples, checkpoints: [], anchors: [0, 10, 20].map((i) => ({ ...samples[i]!, id: i === 0 ? "start" as const : i === 10 ? "apex" as const : "completion" as const, holdMs: 150 })) };
    const frames = [0, 0, 0, 0, 0.1, 0.2, 0.3, 0.4].map((bend, i) => frame(bend, i * 67));
    const before = JSON.stringify({ c, frames });
    const options = { minimumVisibility: 0.65, leniency: 0.25, angleWeight: 0 };
    const actual = new ProgressTracker(c, buildRuntimeTargets(c, 75), options);
    const expected = frames.map((f) => { actual.update(normalizePose(f), true); return actual.diagnostics().currentProgressPercent; });
    const instrumented = instrumentReplay(c, frames, options);
    expect(instrumented.observations.map((r) => r.afterProgress * 100)).toEqual(expected);
    expect(JSON.stringify({ c, frames })).toBe(before);
  });
});
