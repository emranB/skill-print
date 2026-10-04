import { afterEach, describe, expect, it, vi } from "vitest";
import { LivePoseLoop } from "../../src/frontend/pose/LivePoseLoop";
import type { PoseDetector } from "../../src/frontend/pose/PoseDetector";
import type { PoseFrame } from "../../src/frontend/pose/pose.types";

function harness(detectDelayMs: number) {
  let wall = 0;
  vi.spyOn(performance, "now").mockImplementation(() => wall);
  const callbacks: Array<() => void> = [];
  let calls = 0;
  let pending: Array<() => void> = [];
  const detector: PoseDetector = {
    initialize: async () => undefined,
    isBusy: () => false,
    dispose: () => undefined,
    detect: (_video, timestampMs) => {
      calls += 1;
      return new Promise<PoseFrame | null>((resolve) => {
        const done = () => resolve({ timestampMs, landmarks: [], worldLandmarks: [] });
        if (detectDelayMs === 0) done();
        else pending.push(done);
      });
    },
  };
  const frames: PoseFrame[] = [];
  const video = { readyState: 4, paused: false } as unknown as HTMLVideoElement;
  const loop = new LivePoseLoop(detector, video, {
    fps: 15,
    now: () => wall + 1000,
    onFrame: (f) => frames.push(f),
    requestFrame: (cb) => callbacks.push(cb),
    cancelFrame: () => undefined,
  });
  /** Advance one 60 Hz display frame. */
  const step = async () => {
    wall += 1000 / 60;
    const cb = callbacks.shift();
    cb?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  const resolveDetections = async () => {
    const list = pending;
    pending = [];
    list.forEach((f) => f());
    await Promise.resolve();
    await Promise.resolve();
  };
  return { loop, frames, step, resolveDetections, calls: () => calls, scheduled: () => callbacks.length };
}

afterEach(() => vi.restoreAllMocks());

describe("LivePoseLoop", () => {
  it("throttles detection to the configured rate", async () => {
    const h = harness(0);
    h.loop.start();
    for (let i = 0; i < 60; i += 1) await h.step();
    expect(h.calls()).toBeGreaterThanOrEqual(14);
    expect(h.calls()).toBeLessThanOrEqual(16);
    expect(h.frames[0]!.timestampMs).toBeGreaterThan(1000);
  });

  it("never overlaps detections while one is in flight", async () => {
    const h = harness(1);
    h.loop.start();
    for (let i = 0; i < 30; i += 1) await h.step();
    expect(h.calls()).toBe(1);
    expect(h.loop.framesSkippedBusy).toBeGreaterThan(0);
    await h.resolveDetections();
    for (let i = 0; i < 5; i += 1) await h.step();
    expect(h.calls()).toBe(2);
  });

  it("stops scheduling and drops in-flight results after stop", async () => {
    const h = harness(1);
    h.loop.start();
    await h.step();
    h.loop.stop();
    await h.resolveDetections();
    expect(h.frames).toHaveLength(0);
    await h.step();
    expect(h.scheduled()).toBe(0);
    expect(h.loop.isRunning()).toBe(false);
  });
});
