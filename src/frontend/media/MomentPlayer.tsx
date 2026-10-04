import { useEffect, useRef } from "react";

interface Props {
  src?: string | null;
  clipStartMs: number;
  clipEndMs: number;
  className?: string;
}

/**
 * Plays a bounded clip window on a video element (times in ms).
 * The source is only reassigned when it changes, so re-running the effect for a new
 * window (or a development double-run) seeks the loaded video instead of reloading it.
 */
export function MomentPlayer({ src, clipStartMs, clipEndMs, className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;

    const startSec = clipStartMs / 1000;
    const endSec = clipEndMs / 1000;
    const onTimeUpdate = () => {
      if (video.currentTime >= endSec) video.pause();
    };
    const begin = () => {
      video.currentTime = startSec;
      void video.play().catch(() => undefined);
    };

    if (video.getAttribute("src") !== src) video.src = src;
    video.addEventListener("timeupdate", onTimeUpdate);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) begin();
    else video.addEventListener("loadedmetadata", begin, { once: true });

    return () => {
      video.pause();
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", begin);
    };
  }, [src, clipStartMs, clipEndMs]);

  if (!src) {
    return (
      <div className={`moment-player moment-player-empty ${className ?? ""}`}>
        <p className="muted">No video for this moment (pose-only clip).</p>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      className={`moment-player ${className ?? ""}`}
      playsInline
      muted
      controls
      aria-label="Moment replay"
    />
  );
}
