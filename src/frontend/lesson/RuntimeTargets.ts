import { buildCanonicalMovement } from "./CanonicalMovementBuilder";
import type {
  CanonicalMovement,
  CanonicalSample,
  Demonstration,
  MovementAnchor,
  NormalizedPoseGeometry,
} from "../pose/pose.types";
import { difficultyToTargetCount, selectArticulatedTargets } from "./ArticulatedTargets";
export { MAX_TRAJECTORY_TARGETS, difficultyToTargetCount } from "./ArticulatedTargets";

export function difficultyToTrajectoryInterval(matchDifficulty: number): number {
  const value = Number.isFinite(matchDifficulty) ? Math.round(matchDifficulty) : 75;
  return Math.max(1, 100 - Math.max(1, Math.min(100, value)));
}

export function interpolateGeometry(
  a: NormalizedPoseGeometry,
  b: NormalizedPoseGeometry,
  fraction: number,
): NormalizedPoseGeometry {
  return {
    landmarks: a.landmarks.map((p, i) => {
      const q = b.landmarks[i] ?? p;
      return {
        x: p.x + (q.x - p.x) * fraction,
        y: p.y + (q.y - p.y) * fraction,
        z: p.z + (q.z - p.z) * fraction,
        visibility: Math.min(p.visibility ?? 0, q.visibility ?? 0),
      };
    }),
  };
}

export function sampleCanonical(samples: CanonicalSample[], progress01: number): CanonicalSample {
  const upper = samples.findIndex((s) => s.progress01 >= progress01 - 1e-9);
  if (upper <= 0) return { ...samples[upper < 0 ? samples.length - 1 : 0]!, progress01 };
  const a = samples[upper - 1]!;
  const b = samples[upper]!;
  const fraction = (progress01 - a.progress01) / Math.max(1e-9, b.progress01 - a.progress01);
  return {
    progress01,
    phase: progress01 === b.progress01 ? b.phase : a.phase,
    pose: interpolateGeometry(a.pose, b.pose, fraction),
  };
}

/** Upgrade in memory only; loading a legacy lesson never rewrites its stored source. */
export function resolveCanonical(
  canonical: CanonicalMovement,
  demonstrations: Demonstration[] = [],
): CanonicalMovement {
  if (canonical.schemaVersion === 3) {
    if (
      !["rtmw3d-body-v1", "mediapipe-heavy-body3d-v1", "mediapipe-articulated-3d-v1"].includes(
        canonical.representation ?? "",
      ) ||
      !canonical.references?.length
    )
      throw new Error("Invalid 3D reference set");
    return canonical;
  }
  const kind = canonical.kind ?? "cycle";
  let samples = canonical.samples;
  let trajectorySource = canonical.trajectorySource ?? "dense_samples";
  if (!samples?.length && demonstrations.some((d) => d.trajectory.length)) {
    const built = buildCanonicalMovement(demonstrations, kind);
    samples = built.samples;
    trajectorySource = "demonstration_trajectories";
  }
  if (!samples?.length) {
    const cps = canonical.checkpoints;
    const knots = cps.map((c, i) => ({
      progress01: i / Math.max(1, cps.length - 1),
      phase: c.phase,
      pose: c.pose,
    }));
    samples = knots.length
      ? Array.from({ length: 201 }, (_, i) => sampleCanonical(knots, i / 200))
      : [];
    trajectorySource = "legacy_checkpoints";
  }
  if (!samples.length) return { ...canonical, kind, samples, anchors: [], trajectorySource };
  const anchorProgress = kind === "cycle" ? [0, 0.5, 1] : [0, 1];
  const anchors: MovementAnchor[] = canonical.anchors?.length
    ? canonical.anchors
    : anchorProgress.map((p, i) => ({
        ...sampleCanonical(samples!, p),
        id: i === 0 ? "start" : p === 1 ? "completion" : "apex",
        holdMs: 150,
      }));
  return { ...canonical, kind, samples, anchors, trajectorySource };
}

export interface RuntimeTarget extends CanonicalSample {
  index: number;
  anchor?: MovementAnchor;
}

export function buildRuntimeTargets(
  canonical: CanonicalMovement,
  matchDifficulty: number,
): RuntimeTarget[] {
  const dense = resolveCanonical(canonical);
  if (!dense.samples?.length) return [];
  if (dense.representation === "mediapipe-articulated-3d-v1") {
    const reference =
      dense.references?.find((r) => r.samples === canonical.samples) ??
      dense.references?.find((r) => r.samples[0]?.pose === canonical.samples?.[0]?.pose) ??
      dense.references?.find((r) => r.alignmentEligible);
    const source =
      reference?.sourceTrajectory ??
      dense.samples.map((s) => ({ ...s.pose, timestampMs: s.pose.timestampMs ?? 0 }));
    return selectArticulatedTargets(source, difficultyToTargetCount(matchDifficulty)).map(
      (s, index) => ({
        progress01: s.progress01,
        phase: s.phase,
        pose: s.pose,
        index,
        anchor: dense.anchors?.find(
          (a) => a.id === (index === 0 ? "start" : s.progress01 === 1 ? "completion" : ""),
        ),
      }),
    );
  }
  const anchors = dense.anchors!;
  const interval = difficultyToTrajectoryInterval(matchDifficulty) / 100;
  const positions = new Set(anchors.map((a) => a.progress01));
  for (let i = 1; i < anchors.length; i += 1) {
    const start = anchors[i - 1]!.progress01;
    const end = anchors[i]!.progress01;
    for (let fraction = interval; fraction < 1 - 1e-9; fraction += interval) {
      positions.add(Number((start + fraction * (end - start)).toFixed(9)));
    }
  }
  return [...positions]
    .sort((a, b) => a - b)
    .map((p, index) => ({
      ...(dense.schemaVersion === 3
        ? dense.samples!.reduce((a, b) =>
            Math.abs(a.progress01 - p) <= Math.abs(b.progress01 - p) ? a : b,
          )
        : sampleCanonical(dense.samples!, p)),
      progress01: p,
      index,
      anchor: anchors.find((a) => Math.abs(a.progress01 - p) < 1e-8),
    }));
}
