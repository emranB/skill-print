import { describe, expect, it } from "vitest";
import { computeBodyScale, normalizePose } from "../../src/frontend/pose/PoseNormalizer";
import { hipMidpoint } from "../../src/frontend/pose/PoseGeometry";
import type { Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

function frameFromCoords(coords: Array<[number, number]>, visibility = 0.9): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, (_, i) => {
    const pair = coords[i] ?? [0.5, 0.5];
    return { x: pair[0], y: pair[1], z: 0, visibility };
  });
  return { timestampMs: 0, landmarks, worldLandmarks: landmarks };
}

function standing(): PoseFrame {
  const lm: Array<[number, number]> = Array.from({ length: 33 }, () => [0.5, 0.5]);
  lm[11] = [0.4, 0.3];
  lm[12] = [0.6, 0.3];
  lm[23] = [0.42, 0.55];
  lm[24] = [0.58, 0.55];
  lm[25] = [0.42, 0.75];
  lm[16] = [0.62, 0.2];
  return frameFromCoords(lm);
}

describe("PoseNormalizer", () => {
  it("normalizes around hip midpoint with unitless scale", () => {
    const normalized = normalizePose(standing());
    const origin = hipMidpoint(normalized.landmarks);
    expect(origin).not.toBeNull();
    expect(Math.abs(origin!.x)).toBeLessThan(0.15);
    expect(Math.abs(origin!.y)).toBeLessThan(0.15);
    expect(computeBodyScale(standing().landmarks)).toBeGreaterThan(0);
  });

  it("does not zero low-visibility landmarks", () => {
    const pose = standing();
    pose.landmarks[16] = { x: 0.9, y: 0.1, z: 0.2, visibility: 0.05 };
    const normalized = normalizePose(pose, 0.65);
    const lm = normalized.landmarks[16]!;
    expect(lm.x).not.toBe(0);
    expect(lm.y).not.toBe(0);
    expect(Number.isFinite(lm.x)).toBe(true);
    expect(Number.isFinite(lm.y)).toBe(true);
    expect(lm.visibility).toBe(0.05);
  });

  it("keeps finite values for a horizontal body pose", () => {
    const lm: Array<[number, number]> = Array.from({ length: 33 }, () => [0.5, 0.5]);
    lm[11] = [0.25, 0.42];
    lm[12] = [0.25, 0.58];
    lm[23] = [0.7, 0.42];
    lm[24] = [0.7, 0.58];
    const normalized = normalizePose(frameFromCoords(lm));
    for (const landmark of normalized.landmarks) {
      expect(Number.isFinite(landmark.x)).toBe(true);
      expect(Number.isFinite(landmark.y)).toBe(true);
      expect(Number.isFinite(landmark.z)).toBe(true);
    }
    expect(computeBodyScale(frameFromCoords(lm).landmarks)).toBeGreaterThan(0);
  });
});
