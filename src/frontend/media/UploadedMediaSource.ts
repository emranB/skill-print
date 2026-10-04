import { createId } from "../../shared/utils/id";
import type { MediaSource } from "./MediaSource";
import type { TeachingMedia } from "./media.types";

function readVideoDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const durationMs = Math.round(video.duration * 1000);
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file could not be read as a video. Choose an MP4, WebM or MOV file."));
    };
    video.src = url;
  });
}

export class UploadedMediaSource implements MediaSource {
  readonly kind = "upload" as const;

  constructor(private readonly file: File) {}

  async produce(): Promise<TeachingMedia> {
    const durationMs = await readVideoDurationMs(this.file);
    return {
      schemaVersion: 1,
      id: createId(),
      source: "upload",
      durationMs,
      video: this.file,
      sourceName: this.file.name,
    };
  }
}
