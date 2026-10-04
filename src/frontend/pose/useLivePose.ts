import { useEffect, useRef, useState } from "react";
import { DebugBus } from "../debug/DebugBus";
import { LivePoseLoop } from "./LivePoseLoop";
import { MediaPipePoseDetector } from "./PoseDetector";
import type { PoseFrame } from "./pose.types";

export type LivePoseStatus = "idle" | "starting" | "running" | "error";

interface UseLivePoseOptions {
  fps: number;
  now?: () => number;
}

/**
 * Runs pose detection on a live camera stream while `enabled` is true.
 * The detector, offscreen video element and loop are torn down when the
 * stream changes, `enabled` turns false, or the component unmounts.
 */
export function useLivePose(
  stream: MediaStream | null,
  enabled: boolean,
  onFrame: (frame: PoseFrame) => void,
  { fps, now }: UseLivePoseOptions,
): LivePoseStatus {
  const [status, setStatus] = useState<LivePoseStatus>("idle");
  const onFrameRef = useRef(onFrame);
  const nowRef = useRef(now);
  onFrameRef.current = onFrame;
  nowRef.current = now;

  useEffect(() => {
    if (!enabled || !stream) {
      setStatus("idle");
      return undefined;
    }
    let disposed = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const detector = new MediaPipePoseDetector(fps * 4);
    let loop: LivePoseLoop | null = null;
    setStatus("starting");

    void (async () => {
      try {
        await Promise.all([detector.initialize(), video.play()]);
        if (disposed) {
          detector.dispose();
          return;
        }
        loop = new LivePoseLoop(detector, video, {
          fps,
          now: () => (nowRef.current ? nowRef.current() : performance.now()),
          onFrame: (frame) => onFrameRef.current(frame),
        });
        loop.start();
        setStatus("running");
        DebugBus.emit({ category: "POSE", event: "LIVE_POSE_STARTED", data: { fps } });
      } catch (error) {
        if (disposed) return;
        setStatus("error");
        DebugBus.emit({
          category: "POSE",
          level: "error",
          event: "LIVE_POSE_START_FAILED",
          message: error instanceof Error ? error.message : "Live pose start failed",
        });
      }
    })();

    return () => {
      disposed = true;
      if (loop) {
        DebugBus.emit({
          category: "POSE",
          event: "LIVE_POSE_STOPPED",
          data: { delivered: loop.framesDelivered, skippedBusy: loop.framesSkippedBusy },
        });
        loop.stop();
      }
      detector.dispose();
      video.pause();
      video.srcObject = null;
    };
  }, [enabled, stream, fps]);

  return status;
}
