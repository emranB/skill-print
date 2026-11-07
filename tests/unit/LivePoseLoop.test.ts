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
  return {
    loop,
    frames,
    step,
    resolveDetections,
    calls: () => calls,
    scheduled: () => callbacks.length,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("LivePoseLoop", () => {
  it("drains an EOF observation once without resuming recorded playback", async () => {
    let callback!: () => void;
    let resolveDetection!: (frame: PoseFrame) => void;
    const frames: PoseFrame[] = [];
    const video = { readyState: 4, paused: false, ended: true, pause: vi.fn(), play: vi.fn() };
    const detector: PoseDetector = {
      initialize: async () => undefined,
      dispose: () => undefined,
      isBusy: () => false,
      detect: () =>
        new Promise<PoseFrame>((resolve) => {
          resolveDetection = resolve;
        }),
    };
    const loop = new LivePoseLoop(detector, video as unknown as HTMLVideoElement, {
      pauseDuringDetection: true,
      now: () => 100,
      onFrame: (frame) => frames.push(frame),
      requestFrame: (cb) => {
        callback = cb;
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    loop.start();
    callback();
    const drained = loop.drain();
    resolveDetection({ timestampMs: 100, landmarks: [], worldLandmarks: [] });
    await drained;
    expect(frames).toHaveLength(1);
    expect(video.play).not.toHaveBeenCalled();
    expect(loop.isRunning()).toBe(false);
  });
  it.each([false, true])(
    "pauses recorded media through slow inference and never resumes after stop=%s",
    async (stop) => {
      let mediaMs = 0;
      let callback: (() => void) | undefined;
      let resolveDetection!: (frame: PoseFrame) => void;
      const frames: PoseFrame[] = [];
      const video = {
        readyState: 4,
        paused: false,
        ended: false,
        pause: vi.fn(function (this: { paused: boolean }) {
          this.paused = true;
        }),
        play: vi.fn(async function (this: { paused: boolean }) {
          this.paused = false;
        }),
      };
      const detector: PoseDetector = {
        initialize: async () => undefined,
        dispose: () => undefined,
        isBusy: () => false,
        detect: vi.fn(
          () =>
            new Promise<PoseFrame>((resolve) => {
              resolveDetection = resolve;
            }),
        ),
      };
      const loop = new LivePoseLoop(detector, video as unknown as HTMLVideoElement, {
        fps: 15,
        pauseDuringDetection: true,
        now: () => mediaMs,
        onFrame: (frame) => frames.push(frame),
        requestFrame: (cb) => {
          callback = cb;
          return 1;
        },
        cancelFrame: () => {
          callback = undefined;
        },
      });
      loop.start();
      callback!();
      expect(video.pause).toHaveBeenCalledOnce();
      expect(video.paused).toBe(true);
      if (stop) loop.stop();
      resolveDetection({ timestampMs: mediaMs, landmarks: [], worldLandmarks: [] });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(video.play).toHaveBeenCalledTimes(stop ? 0 : 1);
      expect(frames).toHaveLength(stop ? 0 : 1);
      if (!stop) {
        callback!();
        expect(detector.detect).toHaveBeenCalledOnce();
        mediaMs = 67;
        callback!();
        expect(detector.detect).toHaveBeenCalledTimes(2);
        loop.stop();
        resolveDetection({ timestampMs: mediaMs, landmarks: [], worldLandmarks: [] });
      }
    },
  );
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
