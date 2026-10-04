import { useEffect, useRef, useState, type ReactNode } from "react";
import { drawSkeleton, easePose } from "../pose/PoseRenderer";
import type { Landmark } from "../pose/pose.types";
import { VideoViewport } from "./VideoViewport";

const TRACKED = "#3dd68c";
const MISSING = "#ff5c5c";
const GHOST = "#ffb547";
/** Fraction of the remaining distance covered per displayed frame. */
const STUDENT_EASE = 0.4;
const GHOST_EASE = 0.22;

interface Props {
  stream: MediaStream | null;
  /** The person's latest detected pose, in image-normalized coordinates. */
  landmarks?: Landmark[] | null;
  /** Optional target pose drawn behind the person. */
  ghost?: Landmark[] | null;
  floor: number;
  /** Draw untracked joints as red rings so the person sees what the camera is missing. */
  showMissing?: boolean;
  children?: ReactNode;
}

/**
 * Camera feed with the detected skeleton drawn on the person. The overlay
 * canvas takes the video's intrinsic size and the same object-fit, so both
 * crop identically and the skeleton stays on the body. Drawing runs on
 * animation frames and eases toward each new detection.
 */
export function LiveStage({ stream, landmarks = null, ghost = null, floor, showMissing = false, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const targetRef = useRef({ landmarks, ghost });
  const shownRef = useRef<{ student: Landmark[] | null; ghost: Landmark[] | null }>({ student: null, ghost: null });
  targetRef.current = { landmarks, ghost };

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        const target = targetRef.current;
        const shown = shownRef.current;
        shown.student = target.landmarks?.length ? easePose(shown.student, target.landmarks, STUDENT_EASE) : null;
        shown.ghost = target.ghost?.length ? easePose(shown.ghost, target.ghost, GHOST_EASE) : null;
        ctx.clearRect(0, 0, size.width, size.height);
        if (shown.ghost) drawSkeleton(ctx, shown.ghost, size.width, size.height, { color: GHOST, floor: 0, alpha: 0.88 });
        if (shown.student) {
          drawSkeleton(ctx, shown.student, size.width, size.height, {
            color: TRACKED,
            floor,
            missingColor: showMissing ? MISSING : undefined,
          });
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [floor, showMissing, size]);

  return (
    <div className="stage-stack live-stage" data-testid="live-stage" data-tracking={Boolean(landmarks?.length)}>
      <VideoViewport stream={stream} onFrameSize={(width, height) => setSize({ width, height })} />
      <canvas
        ref={canvasRef}
        className="skeleton-canvas"
        width={size.width}
        height={size.height}
        aria-label="Detected body skeleton"
      />
      {stream && !landmarks?.length ? <p className="stage-hint">Looking for your body...</p> : null}
      {children}
    </div>
  );
}
