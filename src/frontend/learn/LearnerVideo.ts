import { LivePoseLoop } from "../pose/LivePoseLoop";
import { MediaPipePoseDetector, type PoseDetector } from "../pose/PoseDetector";
import { normalizePose } from "../pose/PoseNormalizer";
import { poseDistance } from "../pose/PoseDistance";
import { bodyScaleEvidence, isUsablePose, usabilityFloor } from "../pose/PoseUsability";
import type { PoseFrame } from "../pose/pose.types";
import { DebugBus } from "../debug/DebugBus";
import { createId } from "../../shared/utils/id";
import { RTMW3DPoseDetector } from "../pose/RTMW3DPoseDetector";

export const LEARNER_CALIBRATION_HOLD_MS = 500;
export const LEARNER_STABLE_DISTANCE = 0.08;

export class StableLearnerWindow {
  private first: PoseFrame | null = null;
  private lastMs = -Infinity;
  constructor(private readonly minimumVisibility: number) {}
  update(frame: PoseFrame): PoseFrame | null {
    const floor = usabilityFloor(this.minimumVisibility);
    const valid =
      isUsablePose(frame.landmarks, floor) && bodyScaleEvidence(frame.landmarks, floor).ok;
    const gap = frame.timestampMs - this.lastMs;
    this.lastMs = frame.timestampMs;
    if (!valid) {
      this.first = null;
      return null;
    }
    if (
      !this.first ||
      gap > 250 ||
      gap <= 0 ||
      poseDistance(normalizePose(frame), normalizePose(this.first), {
        minimumVisibility: floor,
        planar: true,
        minimumJoints: 6,
      }) > LEARNER_STABLE_DISTANCE
    )
      this.first = frame;
    return frame.timestampMs - this.first.timestampMs >= LEARNER_CALIBRATION_HOLD_MS
      ? this.first
      : null;
  }
}

interface LearnerVideoOptions {
  runId?: string;
  fps: number;
  minimumVisibility: number;
  onFrame: (frame: PoseFrame) => unknown;
  onCalibrated?: (frame: PoseFrame) => void;
  onComplete: (reason: "eof" | "error") => void;
  onError?: (error: unknown) => void;
  detector?: PoseDetector;
  legacy?: boolean;
  representation?: string;
}

/** Uploaded Learn uses the same VIDEO detector and LivePoseLoop as a webcam. */
export class LearnerVideo {
  readonly runId: string;
  private loop: LivePoseLoop | null = null;
  private readonly detector: PoseDetector;
  private cancelled = false;
  private ended = false;
  private completing = false;
  private calibrated = false;
  private evaluating = false;
  private readonly stable: StableLearnerWindow;
  private readonly abort = new AbortController();
  constructor(
    readonly video: HTMLVideoElement,
    private readonly options: LearnerVideoOptions,
  ) {
    this.runId = options.runId ?? createId();
    this.detector =
      options.detector ??
      (options.representation === "rtmw3d-body-v1"
        ? new RTMW3DPoseDetector()
        : new MediaPipePoseDetector(options.fps * 4, {
            legacy: options.legacy,
            representation: options.representation,
          }));
    this.stable = new StableLearnerWindow(options.minimumVisibility);
  }

  async calibrate() {
    DebugBus.emit({
      category: "STUDENT",
      event: "LEARNER_VIDEO_CALIBRATION_STARTED",
      data: { runId: this.runId, source: "upload", startMs: 0 },
    });
    await this.detector.initialize();
    if (this.cancelled) {
      this.detector.dispose();
      return;
    }
    this.video.addEventListener("ended", this.onEnded);
    await this.rewind();
    if (this.cancelled) return;
    this.installLoop();
    await this.video.play();
    this.loop!.start();
  }

  async begin() {
    if (!this.calibrated || this.cancelled || this.evaluating) return;
    this.evaluating = true;
    await this.rewind();
    if (this.cancelled) return;
    this.installLoop();
    await this.video.play();
    this.loop!.start();
  }

  private installLoop() {
    this.loop?.stop();
    this.loop = new LivePoseLoop(this.detector, this.video, {
      fps: this.options.fps,
      pauseDuringDetection: true,
      now: () => this.video.currentTime * 1000,
      onError: (e) => this.fail(e),
      onFrame: (frame) => {
        if (this.cancelled || this.ended) return;
        if (this.evaluating) return this.options.onFrame(frame);
        const stable = this.stable.update(frame);
        if (stable && !this.calibrated) {
          this.calibrated = true;
          this.loop?.stop();
          this.video.pause();
          void this.rewind()
            .then(() => {
              if (!this.cancelled) {
                DebugBus.emit({
                  category: "CALIBRATION",
                  event: "LEARNER_VIDEO_CALIBRATED",
                  data: {
                    runId: this.runId,
                    source: "upload",
                    windowStartMs: stable.timestampMs,
                    rewoundToMs: this.video.currentTime * 1000,
                  },
                });
                this.options.onCalibrated?.(stable);
              }
            })
            .catch((e) => this.fail(e));
        }
      },
    });
  }

  private async rewind() {
    this.loop?.stop();
    this.video.pause();
    if (this.video.readyState < 1) await this.waitFor("loadedmetadata");
    if (this.cancelled) return;
    if (this.video.currentTime !== 0) {
      const seeked = this.waitFor("seeked");
      this.video.currentTime = 0;
      await seeked;
    }
  }

  private waitFor(event: "loadedmetadata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.video.removeEventListener(event, done);
        this.video.removeEventListener("error", failed);
        this.abort.signal.removeEventListener("abort", done);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Learner video could not load or seek"));
      };
      const timer = setTimeout(failed, 15000);
      this.video.addEventListener(event, done, { once: true });
      this.video.addEventListener("error", failed, { once: true });
      this.abort.signal.addEventListener("abort", done, { once: true });
      if (this.cancelled) done();
    });
  }

  private onEnded = async () => {
    if (this.cancelled || this.ended || this.completing) return;
    this.completing = true;
    if (this.loop?.hasPending()) await this.loop.drain();
    else this.loop?.stop();
    if (this.cancelled || this.ended) return;
    this.ended = true;
    this.video.pause();
    if (!this.calibrated) {
      this.options.onError?.(new Error("No consecutive stable calibration window found"));
      this.options.onComplete("error");
    } else if (this.evaluating) this.options.onComplete("eof");
  };

  private fail(error: unknown) {
    if (this.cancelled || this.ended) return;
    this.ended = true;
    this.loop?.stop();
    this.video.pause();
    this.options.onError?.(error);
    this.options.onComplete("error");
  }

  dispose() {
    this.cancelled = true;
    this.abort.abort();
    this.loop?.stop();
    this.video.pause();
    this.video.removeEventListener("ended", this.onEnded);
    this.detector.dispose();
  }
}
