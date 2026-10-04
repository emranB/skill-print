import { createId } from "../../shared/utils/id";
import type { PoseRecording } from "../pose/pose.types";
import type { MediaSource } from "./MediaSource";
import type { TeachingMedia } from "./media.types";

export class ReplayMediaSource implements MediaSource {
  readonly kind = "fixture" as const;

  constructor(
    private readonly poseRecording: PoseRecording,
    private readonly sourceName = "pose-fixture",
  ) {}

  async produce(): Promise<TeachingMedia> {
    const last = this.poseRecording.frames[this.poseRecording.frames.length - 1];
    return {
      schemaVersion: 1,
      id: createId(),
      source: "fixture",
      durationMs: last?.timestampMs ?? 0,
      poseRecording: this.poseRecording,
      sourceName: this.sourceName,
    };
  }
}
