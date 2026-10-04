import { describe, expect, it } from "vitest";
import { detectCyclesWithDiagnostics } from "../../src/frontend/analyze/CycleAnalyzer";
import type { Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

/** Generic body; `raise` in [0,1] lifts both arms overhead. No skill semantics. */
function body(raise: number): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, z: 0, visibility: 0.95 });
  set(11, 0.42, 0.3);
  set(12, 0.58, 0.3);
  set(23, 0.45, 0.55);
  set(24, 0.55, 0.55);
  set(25, 0.45, 0.72);
  set(26, 0.55, 0.72);
  set(27, 0.45, 0.9);
  set(28, 0.55, 0.9);
  set(13, 0.38, 0.42 - 0.28 * raise);
  set(14, 0.62, 0.42 - 0.28 * raise);
  set(15, 0.37, 0.54 - 0.5 * raise);
  set(16, 0.63, 0.54 - 0.5 * raise);
  return lm;
}

/** Piecewise-linear raise profile sampled at 15 fps. */
function recording(profile: Array<[number, number]>): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const end = profile[profile.length - 1]![0];
  for (let t = 0; t <= end; t += 66) {
    let k = 0;
    while (k < profile.length - 2 && profile[k + 1]![0] < t) k += 1;
    const [t0, r0] = profile[k]!;
    const [t1, r1] = profile[k + 1]!;
    const raise = t1 === t0 ? r1 : r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
    const lm = body(Math.max(0, Math.min(1, raise)));
    frames.push({ timestampMs: t, landmarks: lm, worldLandmarks: lm });
  }
  return frames;
}

describe("rest-anchored segmentation", () => {
  it("does not treat an excursion already in progress at the start as a complete cycle", () => {
    const frames = recording([
      [0, 1],
      [1800, 1],
      [2400, 0],
      [5000, 0],
      [6000, 1],
      [7000, 0],
      [9500, 0],
      [10500, 1],
      [11500, 0],
      [14000, 0],
    ]);
    const { demonstrations, diagnostics } = detectCyclesWithDiagnostics(frames);
    expect(diagnostics.restSource).toBe("stable_dwell");
    const complete = demonstrations.filter((d) => d.classification !== "fragment");
    const fragments = demonstrations.filter((d) => d.classification === "fragment");
    expect(complete).toHaveLength(2);
    expect(fragments).toHaveLength(1);
    expect(fragments[0]!.startMs).toBe(0);
    expect(complete[0]!.apexMs).toBeGreaterThan(5000);
    expect(complete[0]!.apexMs).toBeLessThan(7000);
  });

  it("picks the pose the performer dwells in longest as rest, whatever posture it is", () => {
    // Performer rests with arms raised and briefly lowers them: the raised pose is rest.
    const frames = recording([
      [0, 1],
      [3000, 1],
      [3800, 0],
      [4600, 1],
      [8000, 1],
      [8800, 0],
      [9600, 1],
      [12000, 1],
    ]);
    const { demonstrations } = detectCyclesWithDiagnostics(frames);
    const complete = demonstrations.filter((d) => d.classification !== "fragment");
    expect(complete).toHaveLength(2);
    expect(complete[0]!.apexMs).toBeGreaterThan(3000);
    expect(complete[0]!.apexMs).toBeLessThan(4600);
  });
});
