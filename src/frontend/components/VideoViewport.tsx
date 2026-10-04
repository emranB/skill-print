import { useEffect, useRef } from "react";

interface Props {
  stream?: MediaStream | null;
  srcObjectUrl?: string | null;
  muted?: boolean;
  /** Intrinsic frame size, reported when metadata loads and whenever the source resolution changes. */
  onFrameSize?: (width: number, height: number) => void;
}

export function VideoViewport({ stream = null, srcObjectUrl = null, muted = true, onFrameSize }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const onFrameSizeRef = useRef(onFrameSize);
  onFrameSizeRef.current = onFrameSize;

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    const report = () => {
      if (video.videoWidth && video.videoHeight) onFrameSizeRef.current?.(video.videoWidth, video.videoHeight);
    };
    video.addEventListener("loadedmetadata", report);
    video.addEventListener("resize", report);
    return () => {
      video.removeEventListener("loadedmetadata", report);
      video.removeEventListener("resize", report);
    };
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      return () => {
        video.srcObject = null;
      };
    }
    if (srcObjectUrl) {
      video.srcObject = null;
      video.src = srcObjectUrl;
      void video.play().catch(() => undefined);
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    video.srcObject = null;
    video.removeAttribute("src");
  }, [stream, srcObjectUrl]);

  return <video ref={ref} className="video-viewport" playsInline muted={muted} />;
}
