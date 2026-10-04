import { DebugBus } from "../debug/DebugBus";
import type { PoseDetector } from "./PoseDetector";
import type { PoseFrame } from "./pose.types";

/** Display frames rarely land exactly on the interval; without slack 15 FPS degrades to 12 on 60 Hz. */
const FRAME_TOLERANCE_MS = 4;

export interface LivePoseLoopOptions {
  fps?: number;
  /** Timestamp source for emitted frames, e.g. a session clock. */
  now?: () => number;
  onFrame: (frame: PoseFrame) => void;
  onError?: (error: unknown) => void;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * Drives a pose detector from a playing video element on animation frames.
 *
 * Throttles to `fps`, never starts a detection while one is in flight, and
 * stops delivering frames as soon as `stop()` is called, including frames
 * from a detection that was already running.
 */
export class LivePoseLoop {
  private handle: number | null = null;
  private running = false;
  private inFlight = false;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  framesDelivered = 0;
  framesSkippedBusy = 0;

  constructor(
    private readonly detector: PoseDetector,
    private readonly video: HTMLVideoElement,
    private readonly options: LivePoseLoopOptions,
  ) {
    this.intervalMs = 1000 / Math.max(1, options.fps ?? 15);
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame ?? ((h) => window.cancelAnimationFrame(h));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  private schedule(): void {
    if (!this.running) return;
    this.handle = this.requestFrame(() => this.tick());
  }

  private tick(): void {
    this.handle = null;
    if (!this.running) return;
    const wallMs = performance.now();
    const ready = this.video.readyState >= 2 && !this.video.paused;
    if (ready && wallMs - this.lastRunAt >= this.intervalMs - FRAME_TOLERANCE_MS) {
      if (this.inFlight || this.detector.isBusy()) {
        this.framesSkippedBusy += 1;
      } else {
        this.lastRunAt = wallMs;
        this.inFlight = true;
        const timestampMs = this.now();
        this.detector
          .detect(this.video, timestampMs)
          .then((frame) => {
            if (frame && this.running) {
              this.framesDelivered += 1;
              this.options.onFrame(frame);
            }
          })
          .catch((error: unknown) => {
            DebugBus.emit({
              category: "POSE",
              level: "warn",
              event: "LIVE_POSE_DETECT_FAILED",
              message: error instanceof Error ? error.message : "detect failed",
            });
            this.options.onError?.(error);
          })
          .finally(() => {
            this.inFlight = false;
          });
      }
    }
    this.schedule();
  }
}
