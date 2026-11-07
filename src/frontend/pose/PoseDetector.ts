import { DebugBus } from "../debug/DebugBus";
import type { Landmark, PoseFrame } from "./pose.types";
import { heavyBody, HEAVY_MODEL } from "../../shared/movement/HeavyBody";
import { articulatedBody } from "../../shared/movement/ArticulatedBody";

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
  private disposed = false;
  inferenceMs: number[] = [];
  featureMs: number[] = [];
  delegate: "GPU" | "CPU" = "GPU";
  private stats = { frames: 0, visibleSum: 0, minVisible: Number.POSITIVE_INFINITY, since: 0 };

  constructor(sampleFps = 15, private readonly options: { legacy?: boolean; delegate?: "GPU" | "CPU"; representation?:string } = {}) {
    this.sampleIntervalMs = 1000 / Math.max(1, sampleFps);
  }

  async initialize(): Promise<void> {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const { PoseLandmarker, FilesetResolver } = vision;
      const wasm = await FilesetResolver.forVisionTasks(
        "/models/wasm",
      );
      const create = async (delegate: "GPU" | "CPU") => (await PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: this.options.legacy ? "/models/pose_landmarker_full.task" : HEAVY_MODEL,
          delegate,
        },
        runningMode: "VIDEO",
        numPoses: 1,
      })) as unknown as PoseLandmarkerLike;
      this.delegate = this.options.delegate ?? "GPU";
      try { this.landmarker = await create(this.delegate); }
      catch (error) {
        if (this.delegate === "CPU") throw error;
        this.delegate = "CPU";
        this.landmarker = await create("CPU");
        DebugBus.emit({ category: "POSE",event: "POSE_DETECTOR_GPU_FALLBACK",message: "Using browser CPU inference" });
      }
      if (this.disposed) { this.landmarker.close(); this.landmarker=null; return; }

      DebugBus.emit({
        category: "POSE",
        event: "POSE_DETECTOR_READY",
        message: "MediaPipe Pose Landmarker initialized",
        data: { delegate: this.delegate, model: this.options.legacy ? "full-legacy" : "heavy",runningMode:"VIDEO" },
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
      return this.detectObserved(video,timestampMs);
    } finally {
      this.busy = false;
    }
  }

  /** Offline seeks use exactly the live VIDEO inference/representation, without wall-clock throttling. */
  detectObserved(video: HTMLVideoElement, timestampMs: number): PoseFrame | null {
      if (!this.landmarker || this.disposed) return null;
      const now = performance.now();
      const started = now;
      const result = this.landmarker.detectForVideo(video, now);
      this.inferenceMs.push(performance.now()-started);
      const landmarks = toLandmarks(result.landmarks?.[0]);
      const worldLandmarks = toLandmarks(result.worldLandmarks?.[0]);
      if (landmarks.length === 0) return null;

      this.recordStats(landmarks, timestampMs, now);
      const featureStarted=performance.now();
      const body3d=!this.options.legacy && this.options.representation==="mediapipe-heavy-body3d-v1" ? heavyBody(worldLandmarks,landmarks) : undefined;
      const articulated3d=!this.options.legacy && this.options.representation!=="mediapipe-heavy-body3d-v1" ? articulatedBody(worldLandmarks,landmarks) : undefined;
      this.featureMs.push(performance.now()-featureStarted);

      return {
        timestampMs,
        landmarks,
        worldLandmarks,
        ...(body3d ? { body3d } : {}),
        ...(articulated3d ? { articulated3d } : {}),
      };
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
    this.disposed = true;
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
