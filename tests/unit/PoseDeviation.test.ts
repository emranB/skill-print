import { describe, expect, it } from "vitest";
import { describeDeviation, largestDeviation } from "../../src/frontend/learn/PoseDeviation";
import { framingHint, missingJoints } from "../../src/frontend/pose/PoseUsability";
import type { NormalizedLandmark } from "../../src/frontend/pose/pose.types";

function pose(overrides: Record<number, Partial<NormalizedLandmark>> = {}): { landmarks: NormalizedLandmark[] } {
  const landmarks = Array.from({ length: 33 }, (_, i) => ({ x: i * 0.01, y: i * 0.02, z: 0, visibility: 0.9 }));
  for (const [index, patch] of Object.entries(overrides)) Object.assign(landmarks[Number(index)]!, patch);
  return { landmarks };
}

describe("pose deviation", () => {
  it("reports nothing when the poses match", () => {
    expect(largestDeviation(pose(), pose(), 0.5)).toBeNull();
  });

  it("names the farthest visible joint and the way it must move", () => {
    const target = pose({ 25: { y: 0.2 } });
    const student = pose({ 25: { y: 0.9 } });
    const deviation = largestDeviation(student, target, 0.5);
    expect(deviation?.name).toBe("left knee");
    expect(deviation?.direction).toBe("higher");
    expect(describeDeviation(deviation!)).toBe("Bring your left knee higher.");
  });

  it("uses in and out relative to the body centre for sideways errors", () => {
    const target = pose({ 15: { x: 0.3, y: 0.3 } });
    const student = pose({ 15: { x: -0.9, y: 0.3 } });
    expect(largestDeviation(student, target, 0.5)?.direction).toBe("in");
  });

  it("ignores joints the camera cannot see", () => {
    const target = pose({ 27: { y: 0.1 } });
    const student = pose({ 27: { y: 2, visibility: 0.1 } });
    expect(largestDeviation(student, target, 0.5)).toBeNull();
  });
});

describe("framing guidance", () => {
  it("lists missing joints and asks to show the legs when only legs are missing", () => {
    const landmarks = pose({ 25: { visibility: 0.1 }, 27: { visibility: 0.2 } }).landmarks;
    const missing = missingJoints(landmarks, 0.5);
    expect(missing).toEqual([25, 27]);
    expect(framingHint(missing)).toMatch(/knees and feet/);
  });

  it("gives no hint when the whole body is tracked", () => {
    expect(framingHint(missingJoints(pose().landmarks, 0.5))).toBeNull();
  });
});
