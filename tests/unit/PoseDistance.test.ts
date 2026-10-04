import { describe, expect, it } from "vitest";
import { poseDistance, poseSimilarity } from "../../src/frontend/pose/PoseDistance";
import type { NormalizedPoseGeometry } from "../../src/frontend/pose/pose.types";

function geom(offset = 0): NormalizedPoseGeometry {
  const landmarks = Array.from({ length: 33 }, (_, i) => ({
    x: (i % 5) * 0.01 + offset,
    y: (i % 7) * 0.01,
    z: 0,
    visibility: 1,
  }));
  return { landmarks };
}

describe("PoseDistance", () => {
  it("is zero for identical poses", () => {
    const a = geom(0);
    expect(poseDistance(a, a)).toBe(0);
    expect(poseSimilarity(a, a)).toBe(1);
  });

  it("increases with offset", () => {
    const a = geom(0);
    const b = geom(0.2);
    expect(poseDistance(a, b)).toBeGreaterThan(0.1);
    expect(poseSimilarity(a, b)).toBeLessThan(1);
  });
});
