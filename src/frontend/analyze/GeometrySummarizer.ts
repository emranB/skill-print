import { inWindow } from "../../shared/utils/interval";
import { jointAngle } from "../pose/PoseGeometry";
import { normalizePose } from "../pose/PoseNormalizer";
import { poseDistance } from "../pose/PoseDistance";
import { POSE_LANDMARK, type NormalizedPose, type PoseFrame } from "../pose/pose.types";
import type { AnalysisEvidence, GeometryObservation, GeometryObservationKind } from "./analyze.types";

const L = POSE_LANDMARK;

/** Generic MediaPipe kinematic chains. Not skill-specific; all are measured. */
const ANGLE_CHAINS: Array<{ a: number; b: number; c: number; feature: string }> = [
  { a: L.LEFT_SHOULDER, b: L.LEFT_ELBOW, c: L.LEFT_WRIST, feature: "left_elbow_angle" },
  { a: L.RIGHT_SHOULDER, b: L.RIGHT_ELBOW, c: L.RIGHT_WRIST, feature: "right_elbow_angle" },
  { a: L.LEFT_HIP, b: L.LEFT_KNEE, c: L.LEFT_ANKLE, feature: "left_knee_angle" },
  { a: L.RIGHT_HIP, b: L.RIGHT_KNEE, c: L.RIGHT_ANKLE, feature: "right_knee_angle" },
  { a: L.LEFT_ELBOW, b: L.LEFT_SHOULDER, c: L.LEFT_HIP, feature: "left_shoulder_angle" },
  { a: L.RIGHT_ELBOW, b: L.RIGHT_SHOULDER, c: L.RIGHT_HIP, feature: "right_shoulder_angle" },
  { a: L.LEFT_SHOULDER, b: L.LEFT_HIP, c: L.LEFT_KNEE, feature: "left_hip_angle" },
  { a: L.RIGHT_SHOULDER, b: L.RIGHT_HIP, c: L.RIGHT_KNEE, feature: "right_hip_angle" },
];

/** Vertical offset of landmark a relative to b (image y grows downward). */
const VERTICAL_PAIRS: Array<{ a: number; b: number; feature: string }> = [
  { a: L.LEFT_HIP, b: L.LEFT_KNEE, feature: "left_hip_vs_left_knee_height" },
  { a: L.RIGHT_HIP, b: L.RIGHT_KNEE, feature: "right_hip_vs_right_knee_height" },
  { a: L.LEFT_KNEE, b: L.LEFT_ANKLE, feature: "left_knee_vs_left_ankle_height" },
  { a: L.RIGHT_KNEE, b: L.RIGHT_ANKLE, feature: "right_knee_vs_right_ankle_height" },
  { a: L.LEFT_WRIST, b: L.LEFT_SHOULDER, feature: "left_wrist_vs_left_shoulder_height" },
  { a: L.RIGHT_WRIST, b: L.RIGHT_SHOULDER, feature: "right_wrist_vs_right_shoulder_height" },
  { a: L.LEFT_SHOULDER, b: L.LEFT_HIP, feature: "left_shoulder_vs_left_hip_height" },
  { a: L.RIGHT_SHOULDER, b: L.RIGHT_HIP, feature: "right_shoulder_vs_right_hip_height" },
];

/** Bilateral pair spacing. */
const PAIR_DISTANCES: Array<{ a: number; b: number; feature: string }> = [
  { a: L.LEFT_KNEE, b: L.RIGHT_KNEE, feature: "knee_spacing" },
  { a: L.LEFT_ANKLE, b: L.RIGHT_ANKLE, feature: "ankle_spacing" },
  { a: L.LEFT_WRIST, b: L.RIGHT_WRIST, feature: "wrist_spacing" },
  { a: L.LEFT_ELBOW, b: L.RIGHT_ELBOW, feature: "elbow_spacing" },
];

const TRACKED_LANDMARKS = [
  L.LEFT_SHOULDER,
  L.RIGHT_SHOULDER,
  L.LEFT_ELBOW,
  L.RIGHT_ELBOW,
  L.LEFT_WRIST,
  L.RIGHT_WRIST,
  L.LEFT_HIP,
  L.RIGHT_HIP,
  L.LEFT_KNEE,
  L.RIGHT_KNEE,
  L.LEFT_ANKLE,
  L.RIGHT_ANKLE,
];

export interface GeometryWindowOptions {
  apexMs?: number;
  /** Per-landmark visibility floor applied before any ranking. */
  minimumVisibility?: number;
  /** Fraction of window frames that must pass the floor. */
  minimumCoverage?: number;
  maxObservations?: number;
}

const DEFAULTS = { minimumVisibility: 0.5, minimumCoverage: 0.6, maxObservations: 8 };

/** Scale that makes ranges of different kinds comparable for ranking. */
const KIND_SCALE: Record<GeometryObservationKind, number> = {
  angle: 1 / 90,
  relative_position: 1 / 0.5,
  pair_distance: 1 / 0.3,
  excursion: 1 / 0.5,
};

interface Sample {
  t: number;
  value: number;
  visibility: number;
}

function buildObservation(
  feature: string,
  kind: GeometryObservationKind,
  samples: Sample[],
  totalFrames: number,
  startMs: number,
  endMs: number,
  apexMs: number | undefined,
  trackCrossings: boolean,
): GeometryObservation | null {
  if (samples.length < 2) return null;
  let min = samples[0]!;
  let max = samples[0]!;
  let visSum = 0;
  for (const s of samples) {
    if (s.value < min.value) min = s;
    if (s.value > max.value) max = s;
    visSum += s.visibility;
  }
  const coverage = samples.length / Math.max(1, totalFrames);
  const visibility = visSum / samples.length;
  let atApex: number | undefined;
  if (apexMs !== undefined) {
    let best = samples[0]!;
    for (const s of samples) if (Math.abs(s.t - apexMs) < Math.abs(best.t - apexMs)) best = s;
    atApex = best.value;
  }
  let crossingsMs: number[] | undefined;
  if (trackCrossings) {
    crossingsMs = [];
    for (let i = 1; i < samples.length; i += 1) {
      const prev = samples[i - 1]!;
      const cur = samples[i]!;
      if (Math.sign(prev.value) !== Math.sign(cur.value) && prev.value !== 0) crossingsMs.push(cur.t);
    }
  }
  return {
    feature,
    kind,
    startMs,
    endMs,
    min: min.value,
    minAtMs: min.t,
    max: max.value,
    maxAtMs: max.t,
    range: max.value - min.value,
    atApex,
    crossingsMs,
    coverage,
    visibility,
    reliability: coverage * visibility,
  };
}

function describe(o: GeometryObservation): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const digits = o.kind === "angle" ? 0 : 2;
  const unit = o.kind === "angle" ? " deg" : "";
  const base = `${o.feature} ranged ${o.min.toFixed(digits)}${unit} (at ${s(o.minAtMs)}) to ${o.max.toFixed(digits)}${unit} (at ${s(o.maxAtMs)})`;
  const apex = o.atApex !== undefined ? `, ${o.atApex.toFixed(digits)}${unit} at apex` : "";
  const cross =
    o.crossingsMs && o.crossingsMs.length > 0
      ? `, changes sign at ${o.crossingsMs.slice(0, 3).map(s).join(", ")}`
      : "";
  return `${base}${apex}${cross}`;
}

function toEvidence(o: GeometryObservation): AnalysisEvidence {
  return {
    feature: o.feature,
    description: describe(o),
    startMs: o.startMs,
    endMs: o.endMs,
    data: o,
  };
}

function visibleAll(pose: NormalizedPose, indices: number[], floor: number): number | null {
  let sum = 0;
  for (const index of indices) {
    const v = pose.landmarks[index]?.visibility ?? 0;
    if (v < floor) return null;
    sum += v;
  }
  return sum / indices.length;
}

/**
 * Temporal geometry over a half-open window [startMs, endMs).
 *
 * For every generic measurement (joint angles, relative landmark heights,
 * bilateral spacing, whole-pose excursion) the full time series is scanned
 * for extrema, the value at the apex, and sign changes. Measurements whose
 * landmarks fall below the visibility floor in too many frames are dropped
 * before ranking, so occluded joints cannot outrank visible ones.
 */
export function measureGeometryWindow(
  frames: PoseFrame[],
  startMs: number,
  endMs: number,
  options: GeometryWindowOptions = {},
): GeometryObservation[] {
  const floor = options.minimumVisibility ?? DEFAULTS.minimumVisibility;
  const minCoverage = options.minimumCoverage ?? DEFAULTS.minimumCoverage;
  const poses = frames.filter((f) => inWindow(f.timestampMs, startMs, endMs)).map((f) => normalizePose(f));
  if (poses.length < 2) return [];
  const apexMs = options.apexMs !== undefined && inWindow(options.apexMs, startMs, endMs) ? options.apexMs : undefined;
  const out: GeometryObservation[] = [];

  for (const chain of ANGLE_CHAINS) {
    const samples: Sample[] = [];
    for (const pose of poses) {
      const vis = visibleAll(pose, [chain.a, chain.b, chain.c], floor);
      if (vis === null) continue;
      const value = jointAngle(pose.landmarks, chain.a, chain.b, chain.c);
      if (value === null || !Number.isFinite(value)) continue;
      samples.push({ t: pose.timestampMs, value, visibility: vis });
    }
    const o = buildObservation(chain.feature, "angle", samples, poses.length, startMs, endMs, apexMs, false);
    if (o) out.push(o);
  }

  for (const pair of VERTICAL_PAIRS) {
    const samples: Sample[] = [];
    for (const pose of poses) {
      const vis = visibleAll(pose, [pair.a, pair.b], floor);
      if (vis === null) continue;
      const value = pose.landmarks[pair.a]!.y - pose.landmarks[pair.b]!.y;
      samples.push({ t: pose.timestampMs, value, visibility: vis });
    }
    const o = buildObservation(pair.feature, "relative_position", samples, poses.length, startMs, endMs, apexMs, true);
    if (o) out.push(o);
  }

  for (const pair of PAIR_DISTANCES) {
    const samples: Sample[] = [];
    for (const pose of poses) {
      const vis = visibleAll(pose, [pair.a, pair.b], floor);
      if (vis === null) continue;
      const a = pose.landmarks[pair.a]!;
      const b = pose.landmarks[pair.b]!;
      samples.push({ t: pose.timestampMs, value: Math.hypot(a.x - b.x, a.y - b.y), visibility: vis });
    }
    const o = buildObservation(pair.feature, "pair_distance", samples, poses.length, startMs, endMs, apexMs, false);
    if (o) out.push(o);
  }

  const first = poses[0]!;
  const excursion: Sample[] = [];
  for (const pose of poses) {
    const d = poseDistance(pose, first, { minimumVisibility: floor, planar: true });
    if (Number.isFinite(d)) excursion.push({ t: pose.timestampMs, value: d, visibility: 1 });
  }
  const ex = buildObservation("pose_excursion", "excursion", excursion, poses.length, startMs, endMs, apexMs, false);
  if (ex) out.push(ex);

  return out.filter((o) => o.coverage >= minCoverage && o.visibility >= floor);
}

/** Ranked, reliability-filtered observations as evidence records. */
export function summarizeGeometryWindow(
  frames: PoseFrame[],
  startMs: number,
  endMs: number,
  options: GeometryWindowOptions = {},
): AnalysisEvidence[] {
  const max = options.maxObservations ?? DEFAULTS.maxObservations;
  return measureGeometryWindow(frames, startMs, endMs, options)
    .map((o) => ({ o, score: Math.abs(o.range) * KIND_SCALE[o.kind] * o.reliability }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => toEvidence(r.o));
}

/** Landmarks whose reliable observed travel is largest across the demonstration windows. */
export function discoverRequiredLandmarks(
  frames: PoseFrame[],
  startMs: number,
  endMs: number,
  minimumVisibility = DEFAULTS.minimumVisibility,
): number[] {
  const poses = frames.filter((f) => inWindow(f.timestampMs, startMs, endMs + 1)).map((f) => normalizePose(f));
  const anchors = [L.LEFT_HIP, L.RIGHT_HIP];
  if (poses.length < 2) {
    return [L.LEFT_SHOULDER, L.RIGHT_SHOULDER, ...anchors];
  }
  const scored = TRACKED_LANDMARKS.map((index) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let visible = 0;
    for (const pose of poses) {
      const lm = pose.landmarks[index];
      if (!lm || (lm.visibility ?? 0) < minimumVisibility) continue;
      visible += 1;
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    }
    const coverage = visible / poses.length;
    const travel = visible > 1 ? Math.hypot(maxX - minX, maxY - minY) : 0;
    return { index, score: coverage >= 0.5 ? travel * coverage : 0 };
  }).sort((a, b) => b.score - a.score);

  const picked = scored.filter((s) => s.score > 0.05).slice(0, 8).map((s) => s.index);
  const unique = [...new Set<number>([...anchors, ...picked])];
  return unique.length >= 4 ? unique : [...new Set<number>([...anchors, ...scored.slice(0, 4).map((s) => s.index)])];
}
