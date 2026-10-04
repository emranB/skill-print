import { MAJOR_JOINTS } from "./PoseUsability";
import type { Landmark } from "./pose.types";

/** Limb bones between MediaPipe landmarks: shoulders, arms, torso sides, hips, legs. */
export const SKELETON_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

/** Hands and feet: drawn thinner, and only where tracked, so they never add noise. */
export const EXTREMITY_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [15, 19],
  [16, 20],
  [27, 29],
  [29, 31],
  [27, 31],
  [28, 30],
  [30, 32],
  [28, 32],
];

const NOSE = 0;
const VERTEBRAE = 3;

export interface SkeletonStyle {
  color: string;
  /** Visibility at or above which a landmark counts as tracked. */
  floor: number;
  /** When set, untracked major joints and their bones are drawn in this color so gaps are obvious. */
  missingColor?: string;
  alpha?: number;
}

interface Point {
  x: number;
  y: number;
  visibility: number;
}

const inFrame = (p: Landmark | Point) => p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;

function midpoint(a: Landmark | undefined, b: Landmark | undefined): Point | null {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) };
}

/**
 * Draws a pose in image-normalized coordinates onto a canvas of the given
 * size: limbs, a spine from neck to pelvis with vertebra marks, head and
 * neck, hands and feet. Tracked bones are solid with a soft glow; with
 * `missingColor`, bones touching an untracked joint are dashed and untracked
 * joints are hollow rings at the detector's best guess, so the person can
 * see what the camera cannot.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  style: SkeletonStyle,
): void {
  const tracked = (p: Landmark | Point) => (p.visibility ?? 1) >= style.floor;
  const missingColor = style.missingColor;
  const unit = Math.max(2, Math.min(width, height) / 160);
  const px = (p: Landmark | Point) => [p.x * width, p.y * height] as const;

  const stroke = (a: Landmark | Point, b: Landmark | Point, lineWidth: number, ok: boolean) => {
    const [ax, ay] = px(a);
    const [bx, by] = px(b);
    ctx.setLineDash(ok ? [] : [unit * 2, unit * 2]);
    ctx.shadowBlur = ok ? unit * 3 : 0;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = lineWidth + unit * 1.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = ok ? style.color : (missingColor ?? style.color);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };

  const bone = (a: Landmark | Point | null | undefined, b: Landmark | Point | null | undefined, lineWidth: number) => {
    if (!a || !b) return;
    const ok = tracked(a) && tracked(b);
    if (!ok && (!missingColor || !inFrame(a) || !inFrame(b))) return;
    stroke(a, b, ok ? lineWidth : unit, ok);
  };

  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = style.color;

  const neck = midpoint(landmarks[11], landmarks[12]);
  const pelvis = midpoint(landmarks[23], landmarks[24]);

  for (const [a, b] of EXTREMITY_CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (pa && pb && tracked(pa) && tracked(pb)) stroke(pa, pb, unit * 1.1, true);
  }

  for (const [a, b] of SKELETON_CONNECTIONS) bone(landmarks[a], landmarks[b], unit * 1.6);

  bone(neck, pelvis, unit * 2.4);
  const nose = landmarks[NOSE];
  if (nose && neck && tracked(nose) && tracked(neck)) stroke(nose, neck, unit * 1.4, true);
  ctx.setLineDash([]);

  if (neck && pelvis && tracked(neck) && tracked(pelvis)) {
    ctx.shadowBlur = 0;
    for (let i = 1; i <= VERTEBRAE; i += 1) {
      const t = i / (VERTEBRAE + 1);
      const x = (neck.x + (pelvis.x - neck.x) * t) * width;
      const y = (neck.y + (pelvis.y - neck.y) * t) * height;
      ctx.beginPath();
      ctx.arc(x, y, unit * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, unit * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
    }
  }

  if (nose && tracked(nose)) {
    const [x, y] = px(nose);
    ctx.shadowBlur = unit * 3;
    ctx.beginPath();
    ctx.arc(x, y, unit * 3.2, 0, Math.PI * 2);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = unit * 1.1;
    ctx.stroke();
  }

  for (const index of MAJOR_JOINTS) {
    const p = landmarks[index];
    if (!p) continue;
    const [x, y] = px(p);
    ctx.beginPath();
    ctx.arc(x, y, unit * 2, 0, Math.PI * 2);
    if (tracked(p)) {
      ctx.shadowBlur = unit * 4;
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.lineWidth = unit * 0.6;
      ctx.stroke();
    } else if (missingColor && inFrame(p)) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = missingColor;
      ctx.lineWidth = unit;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Moves a displayed pose part of the way toward the latest detection, so
 * the overlay glides between 15 fps pose samples instead of jumping.
 * Display only: analysis always uses the raw detections.
 */
export function easePose(current: Landmark[] | null, target: Landmark[], amount: number): Landmark[] {
  if (!current || current.length !== target.length) return target.map((p) => ({ ...p }));
  return target.map((t, i) => {
    const c = current[i]!;
    return {
      ...t,
      x: c.x + (t.x - c.x) * amount,
      y: c.y + (t.y - c.y) * amount,
      z: c.z + (t.z - c.z) * amount,
    };
  });
}
