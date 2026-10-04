import type { PoseRecording } from "../pose/pose.types";

export type MediaSourceKind = "live" | "upload" | "fixture";

export interface TeachingMedia {
  schemaVersion: 1;
  id: string;
  source: MediaSourceKind;
  durationMs: number;
  video?: Blob | File;
  poseRecording?: PoseRecording;
  sourceName?: string;
}

export function assertTeachingMedia(media: TeachingMedia): void {
  if (!media.video && !media.poseRecording) {
    throw new Error("TeachingMedia requires video and/or poseRecording");
  }
}
