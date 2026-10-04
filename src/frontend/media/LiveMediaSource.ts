import { createId } from "../../shared/utils/id";
import type { PoseRecording } from "../pose/pose.types";
import type { MediaSource } from "./MediaSource";
import type { TeachingMedia } from "./media.types";

export class LiveMediaSource implements MediaSource {
  readonly kind = "live" as const;

  constructor(
    private readonly video: Blob,
    private readonly poseRecording: PoseRecording,
    private readonly durationMs: number,
  ) {}

  async produce(): Promise<TeachingMedia> {
    return {
      schemaVersion: 1,
      id: createId(),
      source: "live",
      durationMs: this.durationMs,
      video: this.video,
      poseRecording: this.poseRecording,
      sourceName: "live-recording",
    };
  }
}
