import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "../../frontend/pose/pose.types";

/** Diagnostic deterministic extraction, shared options for all subjects and models. */
export async function probePoseRepresentation(url: string, model: "full" | "heavy", delegate: "CPU" | "GPU", mode: "IMAGE" | "VIDEO", sampleFps = 15) {
  const wasm = await FilesetResolver.forVisionTasks("/node_modules/@mediapipe/tasks-vision/wasm");
  const detector = await PoseLandmarker.createFromOptions(wasm, {
    baseOptions: {
      modelAssetPath: model === "heavy" ? "/data/diagnostic-models/pose_landmarker_heavy.task" : "/models/pose_landmarker_full.task",
      delegate,
    },
    runningMode: mode, numPoses: 1,
  });
  const video = document.createElement("video");
  const objectUrl=URL.createObjectURL(await (await fetch(url)).blob());
  video.muted = true; video.playsInline = true; video.src = objectUrl;
  const event = (name: "loadedmetadata" | "seeked") => new Promise<void>((resolve, reject) => {
    const cleanup=()=> { video.removeEventListener(name,onOk);video.removeEventListener("error",onError); };
    const onOk=()=> { cleanup();resolve(); };
    const onError=()=> { cleanup();reject(new Error(`Video ${name} failed`)); };
    video.addEventListener(name,onOk,{ once:true });video.addEventListener("error",onError,{ once:true });
  });
  const frames: PoseFrame[] = [];
  const inferenceMs: number[] = [];
  const start = performance.now();
  try {
    await event("loadedmetadata"); await video.play(); video.pause();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d")!;
    for (let ms = 0; ms < video.duration * 1000; ms += 1000 / sampleFps) {
      if (Math.abs(video.currentTime - ms/1000) >= .001) {
        const sought = event("seeked"); video.currentTime = ms/1000; await sought;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const began = performance.now();
      const result = mode === "IMAGE" ? detector.detect(canvas) : detector.detectForVideo(canvas, ms);
      inferenceMs.push(performance.now() - began);
      frames.push({ timestampMs: Math.round(video.currentTime * 1000), landmarks: result.landmarks[0] ?? [], worldLandmarks: result.worldLandmarks[0] ?? [] });
    }
    return { model, delegate, mode, sampleFps, frames, inferenceMs, elapsedMs: performance.now() - start };
  } finally {
    detector.close(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(objectUrl);
  }
}
