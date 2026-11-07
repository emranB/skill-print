import type { PoseDetector } from "./PoseDetector";
import type { PoseFrame } from "./pose.types";

export async function movementRequest<T>(request: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/movement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "3D movement runtime unavailable");
  return result;
}

/** One extraction adapter for camera frames and uploaded teacher/learner frames. */
export class RTMW3DPoseDetector implements PoseDetector {
  private readonly canvas = document.createElement("canvas");
  private busy = false;
  private readonly streamId = crypto.randomUUID();
  private readonly abort = new AbortController();
  async initialize() { await movementRequest({ operation: "status" }, this.abort.signal); }
  isBusy() { return this.busy; }
  async detect(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null> {
    if (this.busy || this.abort.signal.aborted) return null;
    this.busy = true;
    try {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      this.canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      this.canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = this.canvas.getContext("2d");
      if (!context) throw new Error("Pose capture canvas unavailable");
      context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const image = this.canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
      return await movementRequest<PoseFrame>({ operation: "infer", streamId: this.streamId, image, timestampMs }, this.abort.signal);
    } finally { this.busy = false; }
  }
  dispose() { this.abort.abort(); }
}
