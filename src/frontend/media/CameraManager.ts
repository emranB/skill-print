import { DebugBus } from "../debug/DebugBus";

export interface CameraAcquireOptions {
  video?: boolean | MediaTrackConstraints;
  audio?: boolean | MediaTrackConstraints;
}

/**
 * Sole owner of application capture media.
 * ElevenLabs may own its own SDK mic during voice sessions.
 */
export class CameraManager {
  private stream: MediaStream | null = null;
  /** Bumped by every acquire and release so a stream that resolves late is stopped instead of leaked. */
  private generation = 0;
  /** When true, leaving a camera workflow does not stop an explicitly started camera. */
  private keepOpen = false;
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  isKeepOpen(): boolean {
    return this.keepOpen;
  }

  setKeepOpen(keepOpen: boolean): void {
    this.keepOpen = keepOpen;
  }

  isVideoLive(): boolean {
    return Boolean(this.stream?.getVideoTracks().some((track) => track.readyState === "live"));
  }

  isAudioLive(): boolean {
    return Boolean(this.stream?.getAudioTracks().some((track) => track.readyState === "live"));
  }

  /**
   * Reuses the live stream when it already satisfies the request, so Camera On
   * and workflow acquire do not fight each other.
   */
  async ensure(options: CameraAcquireOptions = { video: true, audio: false }): Promise<MediaStream> {
    const wantAudio = Boolean(options.audio);
    if (this.isVideoLive() && this.stream && (!wantAudio || this.isAudioLive())) {
      return this.stream;
    }
    return this.acquire(options);
  }

  async acquire(options: CameraAcquireOptions = { video: true, audio: true }): Promise<MediaStream> {
    this.generation += 1;
    const generation = this.generation;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: options.video ?? true,
        audio: options.audio ?? false,
      });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        DebugBus.emit({ category: "MEDIA", event: "CAMERA_ACQUIRE_SUPERSEDED" });
        throw new CameraRequestSuperseded();
      }
      this.stream = stream;
      DebugBus.emit({
        category: "MEDIA",
        event: "CAMERA_ACQUIRED",
        data: {
          videoTracks: this.stream.getVideoTracks().length,
          audioTracks: this.stream.getAudioTracks().length,
        },
      });
      this.notify();
      return this.stream;
    } catch (error) {
      if (isSupersededError(error)) throw error;
      this.notify();
      DebugBus.emit({
        category: "MEDIA",
        level: "error",
        event: "CAMERA_ACQUIRE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getVideoStream(): MediaStream | null {
    if (!this.stream) return null;
    const tracks = this.stream.getVideoTracks();
    if (tracks.length === 0) return null;
    return new MediaStream(tracks);
  }

  getAudioStream(): MediaStream | null {
    if (!this.stream) return null;
    const tracks = this.stream.getAudioTracks();
    if (tracks.length === 0) return null;
    return new MediaStream(tracks);
  }

  releaseAudio(): void {
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) {
      track.stop();
      this.stream.removeTrack(track);
    }
    DebugBus.emit({ category: "MEDIA", event: "CAMERA_AUDIO_RELEASED" });
    this.notify();
  }

  releaseAll(): void {
    this.generation += 1;
    this.keepOpen = false;
    if (!this.stream) {
      this.notify();
      return;
    }
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
    this.stream = null;
    DebugBus.emit({ category: "MEDIA", event: "CAMERA_RELEASED" });
    this.notify();
  }
}

export const cameraManager = new CameraManager();

/** A newer acquire or a release replaced this request; callers should stay silent. */
export class CameraRequestSuperseded extends Error {
  constructor() {
    super("Camera request was superseded");
    this.name = "CameraRequestSuperseded";
  }
}

export function isSupersededError(error: unknown): boolean {
  return error instanceof CameraRequestSuperseded;
}

/** User-facing explanation for a getUserMedia failure, with a way forward. */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was denied. Allow it in the browser address bar, or choose Upload video.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Connect one, or choose Upload video.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another application. Close it and try again.";
  }
  return "The camera could not be started. Try again, or choose Upload video.";
}
