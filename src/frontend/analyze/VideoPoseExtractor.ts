import { DebugBus } from "../debug/DebugBus";
import { createId } from "../../shared/utils/id";
import { meanVisibility } from "../pose/PoseGeometry";
import type { Landmark, PoseFrame, PoseRecording } from "../pose/pose.types";

const MAX_INFERENCE_WIDTH = 640;

export interface VideoPoseExtractionStats {
  durationMs: number;
  sampleFps: number;
  candidateFrames: number;
  inferenceFrames: number;
  skippedBusy: number;
  validPoseFrames: number;
  emptyPoseFrames: number;
  degradedFrames: number;
  lostFrames: number;
  averageVisibility: number;
  analysisDurationMs: number;
  timestampMonotonic: boolean;
  finiteNormalizedSample: boolean;
}

export interface VideoPoseExtractionResult {
  poseRecording: PoseRecording;
  stats: VideoPoseExtractionStats;
}

type PoseLandmarkerImage = {
  detect: (image: HTMLCanvasElement) => {
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

function waitForEvent(video: HTMLVideoElement, event: keyof HTMLMediaElementEventMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Video ${event} failed`));
    };
    const cleanup = () => {
      video.removeEventListener(event, onOk);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener(event, onOk, { once: true });
    video.addEventListener("error", onErr, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  if (Math.abs(video.currentTime - timeSec) < 0.001) return;
  video.currentTime = timeSec;
  await waitForEvent(video, "seeked");
}

async function createImageLandmarker(modelAssetPath: string): Promise<PoseLandmarkerImage> {
  const vision = await import("@mediapipe/tasks-vision");
  const { PoseLandmarker, FilesetResolver } = vision;
  const wasm = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
  );

  const tryCreate = async (delegate: "GPU" | "CPU") =>
    (await PoseLandmarker.createFromOptions(wasm, {
      baseOptions: {
        modelAssetPath,
        delegate,
      },
      runningMode: "IMAGE",
      numPoses: 1,
    })) as unknown as PoseLandmarkerImage;

  try {
    return await tryCreate("GPU");
  } catch {
    DebugBus.emit({
      category: "POSE",
      level: "warn",
      event: "POSE_DETECTOR_GPU_FALLBACK",
      message: "GPU delegate failed; retrying with CPU",
    });
    return tryCreate("CPU");
  }
}

/**
 * Production offline extractor: TeachingMedia.video to PoseRecording via MediaPipe.
 * Uses IMAGE mode + deterministic seeks so upload analysis does not depend on realtime playback.
 * PoseFrame.timestampMs is SessionTimeMs = video.currentTime * 1000.
 */
export async function extractPoseRecordingFromVideoBlob(
  videoBlob: Blob,
  sessionId: string,
  options?: {
    sampleFps?: number;
    modelAssetPath?: string;
    minimumVisibility?: number;
    onProgress?: (fraction: number) => void;
  },
): Promise<VideoPoseExtractionResult> {
  if (typeof document === "undefined") {
    throw new Error("Video pose extraction requires a browser document context");
  }

  const sampleFps = options?.sampleFps ?? 15;
  const modelAssetPath = options?.modelAssetPath ?? "/models/pose_landmarker_full.task";
  const minimumVisibility = options?.minimumVisibility ?? 0.35;
  const started = performance.now();

  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  let landmarker: PoseLandmarkerImage | null = null;
  const frames: PoseFrame[] = [];
  let candidateFrames = 0;
  let inferenceFrames = 0;
  let skippedBusy = 0;
  let emptyPoseFrames = 0;
  let degradedFrames = 0;
  let lostFrames = 0;
  let visibilitySum = 0;
  let visibilityCount = 0;
  let busy = false;

  try {
    await waitForEvent(video, "loadedmetadata");
    // Some browsers need an explicit load/play-pause to decode frames for seek.
    await video.play().catch(() => undefined);
    video.pause();

    const durationMs = Math.round((Number.isFinite(video.duration) ? video.duration : 0) * 1000);
    if (durationMs <= 0) {
      throw new Error("Video duration unavailable");
    }

    landmarker = await createImageLandmarker(modelAssetPath);
    DebugBus.emit({
      category: "POSE",
      event: "POSE_EXTRACT_START",
      data: {
        durationMs,
        sampleFps,
        modelAssetPath,
        width: video.videoWidth,
        height: video.videoHeight,
      },
    });

    // The landmarker resizes its input far below this, and landmarks are normalized,
    // so a smaller GPU-backed canvas only removes copy cost.
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 360;
    const downscale = Math.min(1, MAX_INFERENCE_WIDTH / sourceWidth);
    canvas.width = Math.round(sourceWidth * downscale);
    canvas.height = Math.round(sourceHeight * downscale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    const intervalMs = 1000 / sampleFps;
    const progressEvery = Math.max(1, Math.round(sampleFps));
    for (let tMs = 0; tMs <= durationMs; tMs += intervalMs) {
      candidateFrames += 1;
      if (candidateFrames % progressEvery === 0) options?.onProgress?.(Math.min(1, tMs / durationMs));
      if (busy) {
        skippedBusy += 1;
        DebugBus.emit({
          category: "POSE",
          level: "debug",
          event: "POSE_FRAME_SKIPPED",
          message: "Extractor busy",
          sessionTimeMs: tMs,
        });
        continue;
      }

      busy = true;
      try {
        await seekVideo(video, Math.min(tMs / 1000, video.duration));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        inferenceFrames += 1;
        const result = landmarker.detect(canvas);
        const landmarks = toLandmarks(result.landmarks?.[0]);
        const worldLandmarks = toLandmarks(result.worldLandmarks?.[0]);

        if (landmarks.length === 0) {
          emptyPoseFrames += 1;
          lostFrames += 1;
          continue;
        }

        const vis = meanVisibility(landmarks);
        visibilitySum += vis;
        visibilityCount += 1;
        if (vis < minimumVisibility) {
          degradedFrames += 1;
          if (vis < 0.15) {
            lostFrames += 1;
            continue;
          }
        }

        frames.push({
          timestampMs: Math.round(video.currentTime * 1000),
          landmarks,
          worldLandmarks,
        });
      } finally {
        busy = false;
      }
    }

    let timestampMonotonic = true;
    for (let i = 1; i < frames.length; i += 1) {
      if (frames[i]!.timestampMs < frames[i - 1]!.timestampMs) {
        timestampMonotonic = false;
        break;
      }
    }

    const stats: VideoPoseExtractionStats = {
      durationMs,
      sampleFps,
      candidateFrames,
      inferenceFrames,
      skippedBusy,
      validPoseFrames: frames.length,
      emptyPoseFrames,
      degradedFrames,
      lostFrames,
      averageVisibility: visibilityCount ? visibilitySum / visibilityCount : 0,
      analysisDurationMs: Math.round(performance.now() - started),
      timestampMonotonic,
      finiteNormalizedSample: frames.every((f) =>
        f.landmarks.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z)),
      ),
    };

    DebugBus.emit({
      category: "POSE",
      event: "POSE_EXTRACT_COMPLETE",
      data: stats,
    });

    return {
      poseRecording: {
        schemaVersion: 1,
        id: createId(),
        sessionId,
        frames,
      },
      stats,
    };
  } finally {
    landmarker?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
