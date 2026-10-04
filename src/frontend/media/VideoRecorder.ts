import { DebugBus } from "../debug/DebugBus";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

/**
 * Consumes CameraManager streams but does not own or stop them.
 */
export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | undefined;

  start(stream: MediaStream): void {
    this.chunks = [];
    this.mimeType = pickRecorderMimeType();
    this.recorder = this.mimeType
      ? new MediaRecorder(stream, { mimeType: this.mimeType })
      : new MediaRecorder(stream);

    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };

    DebugBus.emit({
      category: "MEDIA",
      event: "RECORDER_STARTED",
      data: { mimeType: this.recorder.mimeType },
    });
    this.recorder.start(250);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error("Recorder not started"));
        return;
      }
      const recorder = this.recorder;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "video/webm" });
        DebugBus.emit({
          category: "MEDIA",
          event: "RECORDER_STOPPED",
          data: { bytes: blob.size, mimeType: blob.type },
        });
        this.recorder = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }

  isRecording(): boolean {
    return this.recorder?.state === "recording";
  }
}
