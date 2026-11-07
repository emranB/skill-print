import { describe, expect, it } from "vitest";
import { anglePenalty, measureAngleErrors, MAX_ANGLE_WEIGHT } from "../../src/frontend/pose/PoseAngles";
import { comparePose } from "../../src/frontend/pose/PoseComparator";
import { normalizePose } from "../../src/frontend/pose/PoseNormalizer";
import { syntheticReferenceFrame } from "../../src/frontend/teach/syntheticPose";

describe("conservative angle scoring", () => {
  const teacher = normalizePose(syntheticReferenceFrame());
  it("defaults to POSITION only and never rewards an angle mismatch", () => {
    const student = structuredClone(teacher);
    student.landmarks[25]!.x += 0.4;
    student.landmarks[26]!.x -= 0.4;
    const options = { leniency: 0.25, minimumVisibility: 0.65, trackingValid: true };
    const base = comparePose(student, teacher, options);
    expect(comparePose(student, teacher, { ...options, angleWeight: 0 })).toEqual(base);
    expect(comparePose(student, teacher, { ...options, angleWeight: 0.05 }).similarity).toBeLessThanOrEqual(base.similarity);
    expect(anglePenalty(student, teacher, 0.65, 1).penalty).toBeLessThanOrEqual(MAX_ANGLE_WEIGHT);
    expect(anglePenalty(student, teacher, 0.65, 0.05).penalty).toBeGreaterThan(0);
  });
  it("does not penalize fewer than three visible non-degenerate chains", () => {
    const hidden = structuredClone(teacher);
    hidden.landmarks.forEach((p) => { p.visibility = 0.2; });
    expect(measureAngleErrors(hidden, teacher, 0.8)).toHaveLength(0);
    expect(anglePenalty(hidden, teacher, 0.65, 0.05).penalty).toBe(0);
    for (const index of [11, 23, 25, 27]) hidden.landmarks[index]!.visibility = 1;
    hidden.landmarks[25]!.x += 0.4;
    expect(measureAngleErrors(hidden, teacher, 0.8)).toHaveLength(2);
    expect(anglePenalty(hidden, teacher, 0.65, 0.05).penalty).toBe(0);
    const collapsed = structuredClone(teacher);
    collapsed.landmarks.forEach((p) => { p.x = 0; p.y = 0; });
    expect(measureAngleErrors(collapsed, teacher, 0.8)).toHaveLength(0);
  });
  it("identical geometry has no penalty even with enabled weight", () => {
    expect(anglePenalty(teacher, teacher, 0.65, 0.05).penalty).toBe(0);
    expect(anglePenalty(teacher, teacher, 0.65, NaN).penalty).toBe(0);
  });
});
