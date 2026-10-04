import { describe, expect, it } from "vitest";
import { summarizeGeometryWindow } from "../../src/frontend/analyze/GeometrySummarizer";
import type { Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

function frame(t: number, mutate: (landmarks: Landmark[]) => void): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  }));
  landmarks[11] = { x: 0.4, y: 0.3, z: 0, visibility: 0.95 };
  landmarks[12] = { x: 0.6, y: 0.3, z: 0, visibility: 0.95 };
  landmarks[13] = { x: 0.35, y: 0.4, z: 0, visibility: 0.95 };
  landmarks[14] = { x: 0.65, y: 0.4, z: 0, visibility: 0.95 };
  landmarks[15] = { x: 0.32, y: 0.5, z: 0, visibility: 0.95 };
  landmarks[16] = { x: 0.68, y: 0.5, z: 0, visibility: 0.95 };
  landmarks[23] = { x: 0.42, y: 0.55, z: 0, visibility: 0.95 };
  landmarks[24] = { x: 0.58, y: 0.55, z: 0, visibility: 0.95 };
  landmarks[25] = { x: 0.42, y: 0.75, z: 0, visibility: 0.95 };
  landmarks[26] = { x: 0.58, y: 0.75, z: 0, visibility: 0.95 };
  landmarks[27] = { x: 0.42, y: 0.9, z: 0, visibility: 0.95 };
  landmarks[28] = { x: 0.58, y: 0.9, z: 0, visibility: 0.95 };
  mutate(landmarks);
  return { timestampMs: t, landmarks, worldLandmarks: landmarks };
}

describe("GeometrySummarizer", () => {
  it("selects the joints that actually moved rather than a fixed skill joint", () => {
    const frames = [
      frame(0, () => undefined),
      frame(400, (landmarks) => {
        landmarks[13] = { x: 0.2, y: 0.2, z: 0, visibility: 0.95 };
        landmarks[15] = { x: 0.1, y: 0.15, z: 0, visibility: 0.95 };
      }),
    ];
    const observations = summarizeGeometryWindow(frames, 0, 401);
    expect(observations.length).toBeGreaterThan(0);
    const features = observations.map((o) => o.feature);
    expect(features.some((f) => f.includes("elbow") || f.includes("wrist") || f === "pose_excursion")).toBe(
      true,
    );
    expect(features[0]).not.toBe("left_knee_angle");
  });
});
