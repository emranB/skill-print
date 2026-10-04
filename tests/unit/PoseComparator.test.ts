import { describe, expect, it } from "vitest";
import { comparePose } from "../../src/frontend/pose/PoseComparator";
import type { NormalizedPoseGeometry } from "../../src/frontend/pose/pose.types";

const geom: NormalizedPoseGeometry = {
  landmarks: Array.from({ length: 33 }, () => ({ x: 0.1, y: 0.2, z: 0, visibility: 1 })),
};

describe("PoseComparator", () => {
  it("fails when tracking invalid even at max leniency", () => {
    const result = comparePose(geom, geom, {
      leniency: 1,
      minimumVisibility: 0.2,
      trackingValid: false,
    });
    expect(result.passed).toBe(false);
  });
});
