import { afterEach, describe, expect, it, vi } from "vitest";
import { StableLearnerWindow, LearnerVideo } from "../../src/frontend/learn/LearnerVideo";
import { LearningRun } from "../../src/frontend/learn/LearningRun";
import { RuntimeConfigManager } from "../../src/frontend/config/RuntimeConfig";
import { DebugBus } from "../../src/frontend/debug/DebugBus";
import type { PoseFrame } from "../../src/frontend/pose/pose.types";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import { syntheticReferenceFrame } from "../../src/frontend/teach/syntheticPose";
import type { PoseDetector } from "../../src/frontend/pose/PoseDetector";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const frame = (timestampMs: number): PoseFrame => ({ ...syntheticReferenceFrame(), timestampMs });

describe("learner lifecycle", () => {
  it("cancels pending metadata without leaked listeners or starting playback", async () => {
    class Video extends EventTarget {
      readyState = 0; currentTime = 0;
      play = vi.fn(); pause = vi.fn();
    }
    const video = new Video();
    const detector: PoseDetector = { initialize: async () => undefined, isBusy: () => false, dispose: vi.fn(), detect: async () => null };
    const complete = vi.fn();
    const controller = new LearnerVideo(video as unknown as HTMLVideoElement, { fps: 15, minimumVisibility: 0.65, detector, onFrame: vi.fn(), onComplete: complete });
    const pending = controller.calibrate();
    await Promise.resolve();
    controller.dispose();
    await pending;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("ended"));
    expect(video.play).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(detector.dispose).toHaveBeenCalledOnce();
  });
  it("calibration takes the first consecutive stable window and resets across dropouts", () => {
    const stable = new StableLearnerWindow(0.65);
    for (let ms = 0; ms < 500; ms += 67) expect(stable.update(frame(ms))).toBeNull();
    const bad = frame(500); bad.landmarks = [];
    expect(stable.update(bad)).toBeNull();
    for (let ms = 567; ms < 1067; ms += 67) expect(stable.update(frame(ms))).toBeNull();
    expect(stable.update(frame(1100))?.timestampMs).toBe(567);
  });
  it("finish is idempotent, rejects an incomplete cycle, and stops accepting frames", () => {
    const emit = vi.spyOn(DebugBus, "emit");
    const lesson = { canonicalMovement: { checkpoints: [] }, demonstrations: [] } as unknown as Lesson;
    const run = new LearningRun(lesson, RuntimeConfigManager.get(), "upload");
    run.processStudentFrame(frame(0));
    const first = run.finish("eof");
    expect(run.finish("eof")).toBe(first);
    expect(first.mastery).toBe(false); expect(first.incompleteReason).toBe("never_reached_apex");
    expect(run.processStudentFrame(frame(67))).toBeNull(); expect(run.frames).toBe(1);
    expect(emit.mock.calls.filter(([e]) => e.event === "LEARN_EVALUATION_COMPLETE")).toHaveLength(1);
    expect(first.runId).toBe(run.runId);
  });
  it("upload starts at zero, rewinds calibration, emits one EOF, and never requests a webcam", async () => {
    let wall = 0;
    vi.spyOn(performance, "now").mockImplementation(() => wall);
    const callbacks = new Map<number, () => void>(); let next = 0;
    const gum = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: gum } });
    vi.stubGlobal("window", { requestAnimationFrame: (cb: () => void) => { callbacks.set(++next, cb); return next; }, cancelAnimationFrame: (id: number) => callbacks.delete(id) });
    class Video extends EventTarget {
      readyState = 4; paused = true; time = 0;
      get currentTime() { return this.time; }
      set currentTime(t: number) { this.time = t; queueMicrotask(() => this.dispatchEvent(new Event("seeked"))); }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
    }
    const video = new Video(); const received: PoseFrame[] = [];
    const complete = vi.fn(); const calibrated = vi.fn();
    const detector: PoseDetector = { initialize: async () => undefined, isBusy: () => false, dispose: vi.fn(), detect: async (_v, ms) => frame(ms) };
    const controller = new LearnerVideo(video as unknown as HTMLVideoElement, { fps: 15, minimumVisibility: 0.65, detector, onFrame: (f) => received.push(f), onComplete: complete, onCalibrated: calibrated });
    await controller.calibrate(); expect(video.currentTime).toBe(0);
    for (let i = 0; i < 12; i++) {
      wall += 67; if (!video.paused) video.time = wall / 1000;
      const list = [...callbacks.values()]; callbacks.clear(); list.forEach((cb) => cb());
      for (let j = 0; j < 6; j++) await Promise.resolve();
    }
    expect(calibrated).toHaveBeenCalledOnce(); expect(video.currentTime).toBe(0); expect(received).toHaveLength(0);
    await controller.begin();
    wall += 67; video.time = 0.067;
    const list = [...callbacks.values()]; callbacks.clear(); list.forEach((cb) => cb());
    for (let j = 0; j < 6; j++) await Promise.resolve();
    expect(received).toHaveLength(1);
    video.dispatchEvent(new Event("ended")); video.dispatchEvent(new Event("ended"));
    expect(complete).toHaveBeenCalledExactlyOnceWith("eof"); expect(gum).not.toHaveBeenCalled();
    controller.dispose(); expect(callbacks.size).toBe(0); expect(detector.dispose).toHaveBeenCalledOnce();
  });
});
