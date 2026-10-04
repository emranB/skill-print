import { useEffect, useRef } from "react";
import { drawSkeleton } from "../pose/PoseRenderer";
import type { Landmark } from "../pose/pose.types";

interface Props {
  landmarks?: Landmark[] | null;
  color?: string;
  width?: number;
  height?: number;
}

export function SkeletonCanvas({
  landmarks = null,
  color = "#3dd68c",
  width = 640,
  height = 480,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (landmarks?.length) drawSkeleton(ctx, landmarks, width, height, { color, floor: 0.3 });
  }, [landmarks, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="skeleton-canvas"
      width={width}
      height={height}
      aria-label="Pose skeleton"
    />
  );
}
