import { DebugBus } from "../debug/DebugBus";
import type { Landmark, PoseFrame } from "./pose.types";

const STATS_INTERVAL_MS = 1000;

export interface PoseDetector {
  initialize(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null>;
  isBusy(): boolean;
  dispose(): void;
}

type PoseLandmarkerLike = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    landmarks?: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
    worldLandmarks?: Array<Array<{ x: number; y: number; z: number; visibility?: number }>>;
  };
  close: () => void;
};

function toLandmarks(
  points?: Array<{ x: number; y: number; z: number; visibility?: number }>,
): Landmark[] {
  if (!points) return [];
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility,
  }));
}

/**
 * MediaPipe Pose Landmarker behind an interface.
 * Busy frames are skipped by the caller when isBusy() is true.
 */
export class MediaPipePoseDetector implements PoseDetector {
  private landmarker: PoseLandmarkerLike | null = null;
  private busy = false;
  private lastInferAt = 0;
  private readonly sampleIntervalMs: number;
  private stats = { frames: 0, visibleSum: 0, minVisible: Number.POSITIVE_INFINITY, since: 0 };

  constructor(sampleFps = 15) {
    this.sampleIntervalMs = 1000 / Math.max(1, sampleFps);
  }

  async initialize(): Promise<void> {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const { PoseLandmarker, FilesetResolver } = vision;
      const wasm = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
      );
      this.landmarker = (await PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: "/models/pose_landmarker_full.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      })) as unknown as PoseLandmarkerLike;

      DebugBus.emit({
        category: "POSE",
        event: "POSE_DETECTOR_READY",
        message: "MediaPipe Pose Landmarker initialized",
      });
    } catch (error) {
      DebugBus.emit({
        category: "POSE",
        level: "error",
        event: "POSE_DETECTOR_INIT_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  async detect(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null> {
    if (!this.landmarker) return null;
    if (this.busy) {
      DebugBus.emit({
        category: "POSE",
        level: "debug",
        event: "POSE_FRAME_SKIPPED",
        message: "Detector busy",
        sessionTimeMs: timestampMs,
      });
      return null;
    }

    const now = performance.now();
    if (now - this.lastInferAt < this.sampleIntervalMs) {
      return null;
    }

    this.busy = true;
    this.lastInferAt = now;
    try {
      const result = this.landmarker.detectForVideo(video, now);
      const landmarks = toLandmarks(result.landmarks?.[0]);
      const worldLandmarks = toLandmarks(result.worldLandmarks?.[0]);
      if (landmarks.length === 0) return null;

      this.recordStats(landmarks, timestampMs, now);

      return {
        timestampMs,
        landmarks,
        worldLandmarks,
      };
    } finally {
      this.busy = false;
    }
  }

  /** One debug summary per second instead of one event per frame. */
  private recordStats(landmarks: Landmark[], timestampMs: number, now: number): void {
    const visible = landmarks.filter((l) => (l.visibility ?? 0) >= 0.5).length;
    const s = this.stats;
    if (s.frames === 0) s.since = now;
    s.frames += 1;
    s.visibleSum += visible;
    s.minVisible = Math.min(s.minVisible, visible);
    if (now - s.since < STATS_INTERVAL_MS) return;
    DebugBus.emit({
      category: "POSE",
      level: "debug",
      event: "POSE_FRAMES",
      sessionTimeMs: timestampMs,
      data: {
        frames: s.frames,
        landmarkCount: landmarks.length,
        averageVisible: Math.round((s.visibleSum / s.frames) * 10) / 10,
        minVisible: s.minVisible,
      },
    });
    this.stats = { frames: 0, visibleSum: 0, minVisible: Number.POSITIVE_INFINITY, since: now };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/** Injectable detector for Level C tests (no WASM). */
export class InjectedPoseDetector implements PoseDetector {
  private queue: PoseFrame[] = [];
  private busy = false;

  enqueue(frames: PoseFrame[]): void {
    this.queue.push(...frames);
  }

  async initialize(): Promise<void> {
    // no-op
  }

  isBusy(): boolean {
    return this.busy;
  }

  async detect(_video: HTMLVideoElement, _timestampMs: number): Promise<PoseFrame | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      return this.queue.shift() ?? null;
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    this.queue = [];
  }
}
