import { createId } from "../../shared/utils/id";
import type { PoseFrame, PoseRecording } from "./pose.types";

export class PoseRecorder {
  private frames: PoseFrame[] = [];
  private readonly id = createId();

  constructor(private readonly sessionId: string) {}

  add(frame: PoseFrame): void {
    this.frames.push(frame);
  }

  clear(): void {
    this.frames = [];
  }

  count(): number {
    return this.frames.length;
  }

  toRecording(): PoseRecording {
    return {
      schemaVersion: 1,
      id: this.id,
      sessionId: this.sessionId,
      frames: [...this.frames],
    };
  }
}
