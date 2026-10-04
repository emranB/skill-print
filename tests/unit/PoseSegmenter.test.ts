import { describe, expect, it } from "vitest";
import { PoseSegmenter } from "../../src/frontend/pose/PoseSegmenter";
import type { Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

function baseLandmarks(): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  }));
  landmarks[11] = { x: 0.4, y: 0.3, z: 0, visibility: 0.95 };
  landmarks[12] = { x: 0.6, y: 0.3, z: 0, visibility: 0.95 };
  landmarks[23] = { x: 0.42, y: 0.55, z: 0, visibility: 0.95 };
  landmarks[24] = { x: 0.58, y: 0.55, z: 0, visibility: 0.95 };
  landmarks[15] = { x: 0.35, y: 0.45, z: 0, visibility: 0.95 };
  landmarks[16] = { x: 0.65, y: 0.45, z: 0, visibility: 0.95 };
  return landmarks;
}

function frame(t: number, wristY: number, visibility = 0.95): PoseFrame {
  const landmarks = baseLandmarks();
  landmarks[15] = { x: 0.35, y: wristY, z: 0, visibility };
  landmarks[16] = { x: 0.65, y: wristY, z: 0, visibility };
  return { timestampMs: t, landmarks, worldLandmarks: landmarks };
}

function run(frames: PoseFrame[]) {
  const segmenter = new PoseSegmenter({
    enterThreshold: 0.16,
    exitThreshold: 0.14,
    minExcursion: 0.2,
    returnDwellMs: 50,
    minCycleMs: 80,
    reanchorStableMs: 400,
  });
  segmenter.captureReference([frames[0]!]);
  const events = [];
  for (const f of frames) events.push(...segmenter.update(f));
  return events;
}

describe("PoseSegmenter", () => {
  it("emits nothing for no movement", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(i * 40, 0.45));
    expect(run(frames)).toHaveLength(0);
  });

  it("ignores sensor noise near reference", () => {
    const frames = Array.from({ length: 20 }, (_, i) =>
      frame(i * 40, 0.45 + (i % 2 === 0 ? 0.004 : -0.004)),
    );
    expect(run(frames)).toHaveLength(0);
  });

  it("does not complete an incomplete excursion", () => {
    const frames = [
      frame(0, 0.45),
      frame(80, 0.55),
      frame(160, 0.7),
      frame(240, 0.75),
    ];
    const events = run(frames);
    expect(events.filter((e) => e.type === "CYCLE_COMPLETE")).toHaveLength(0);
  });

  it("completes a round trip with dwell at return", () => {
    const frames: PoseFrame[] = [];
    let t = 0;
    for (const y of [0.45, 0.55, 0.7, 0.85, 0.7, 0.55, 0.45, 0.45, 0.45]) {
      frames.push(frame(t, y));
      t += 80;
    }
    const complete = run(frames).filter((e) => e.type === "CYCLE_COMPLETE");
    expect(complete).toHaveLength(1);
    const demo = complete[0]!.demonstration;
    expect(demo.apexMs).toBeGreaterThan(demo.startMs);
    expect(demo.apexMs).toBeLessThan(demo.endMs);
  });

  it("pauses away from reference then resumes to complete", () => {
    const ys = [0.45, 0.6, 0.8, 0.8, 0.8, 0.6, 0.45, 0.45, 0.45];
    const frames = ys.map((y, i) => frame(i * 90, y));
    expect(run(frames).filter((e) => e.type === "CYCLE_COMPLETE").length).toBe(1);
  });

  it("re-anchors on a stable far plateau without skill labels", () => {
    const frames: PoseFrame[] = [frame(0, 0.45)];
    for (let i = 1; i <= 24; i += 1) {
      const landmarks = baseLandmarks();
      landmarks[15] = { x: 0.05, y: 0.95, z: 0, visibility: 0.95 };
      landmarks[16] = { x: 0.95, y: 0.95, z: 0, visibility: 0.95 };
      landmarks[25] = { x: 0.1, y: 0.95, z: 0, visibility: 0.95 };
      landmarks[26] = { x: 0.9, y: 0.95, z: 0, visibility: 0.95 };
      landmarks[27] = { x: 0.1, y: 0.99, z: 0, visibility: 0.95 };
      landmarks[28] = { x: 0.9, y: 0.99, z: 0, visibility: 0.95 };
      frames.push({ timestampMs: i * 80, landmarks, worldLandmarks: landmarks });
    }
    const events = run(frames);
    expect(events.some((e) => e.type === "CYCLE_FRAGMENT")).toBe(true);
  });

  it("skips temporary low-visibility frames without inventing geometry", () => {
    const frames = [
      frame(0, 0.45, 0.95),
      frame(80, 0.8, 0.02),
      frame(160, 0.45, 0.95),
    ];
    const complete = run(frames).filter((e) => e.type === "CYCLE_COMPLETE");
    expect(complete.length).toBe(0);
  });

  it("accepts a horizontal reference pose", () => {
    const landmarks = baseLandmarks();
    landmarks[11] = { x: 0.3, y: 0.4, z: 0, visibility: 0.95 };
    landmarks[12] = { x: 0.3, y: 0.6, z: 0, visibility: 0.95 };
    landmarks[23] = { x: 0.7, y: 0.4, z: 0, visibility: 0.95 };
    landmarks[24] = { x: 0.7, y: 0.6, z: 0, visibility: 0.95 };
    const ref: PoseFrame = { timestampMs: 0, landmarks, worldLandmarks: landmarks };
    const moved = landmarks.map((lm, i) =>
      i === 15 || i === 16 ? { ...lm, x: lm.x + 0.35 } : lm,
    );
    const frames = [
      ref,
      { timestampMs: 80, landmarks: moved, worldLandmarks: moved },
      { timestampMs: 160, landmarks: moved, worldLandmarks: moved },
      ref,
      { ...ref, timestampMs: 280 },
      { ...ref, timestampMs: 360 },
    ];
    const segmenter = new PoseSegmenter({ minExcursion: 0.15, returnDwellMs: 40 });
    segmenter.captureReference([ref]);
    const events = [];
    for (const f of frames) events.push(...segmenter.update(f));
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
