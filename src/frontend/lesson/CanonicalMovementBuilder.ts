import { median } from "../../shared/utils/math";
import type {
  CanonicalCheckpoint,
  CanonicalMovement,
  Demonstration,
  NormalizedLandmark,
  NormalizedPose,
  NormalizedPoseGeometry,
} from "../pose/pose.types";

function sampleAtProgress(poses: NormalizedPose[], progress: number): NormalizedPoseGeometry {
  if (poses.length === 0) return { landmarks: [] };
  if (poses.length === 1) return { landmarks: poses[0]!.landmarks };
  const idx = Math.min(poses.length - 1, Math.round((progress / 100) * (poses.length - 1)));
  return { landmarks: poses[idx]!.landmarks };
}

function medianGeometry(geometries: NormalizedPoseGeometry[]): NormalizedPoseGeometry {
  if (geometries.length === 0) return { landmarks: [] };
  const landmarkCount = geometries[0]!.landmarks.length;
  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < landmarkCount; i += 1) {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const vs: number[] = [];
    for (const g of geometries) {
      const lm = g.landmarks[i];
      if (!lm) continue;
      xs.push(lm.x);
      ys.push(lm.y);
      zs.push(lm.z);
      vs.push(lm.visibility ?? 0);
    }
    landmarks.push({
      x: median(xs),
      y: median(ys),
      z: median(zs),
      visibility: median(vs),
    });
  }
  return { landmarks };
}

function splitOutboundReturn(trajectory: NormalizedPose[], apexMs: number): {
  outbound: NormalizedPose[];
  returning: NormalizedPose[];
} {
  const outbound = trajectory.filter((p) => p.timestampMs <= apexMs);
  const returning = trajectory.filter((p) => p.timestampMs >= apexMs);
  return {
    outbound: outbound.length ? outbound : trajectory.slice(0, 1),
    returning: returning.length ? returning : trajectory.slice(-1),
  };
}

/**
 * Build 9 ordered checkpoints from confirmed good demonstrations.
 * Checkpoint poses are geometry only (no timestamps).
 */
export function buildCanonicalMovement(demonstrations: Demonstration[]): CanonicalMovement {
  const good = demonstrations.filter((d) => d.classification === "good" && d.teacherConfirmed);
  const source = good.length > 0 ? good : demonstrations.filter((d) => d.trajectory.length > 0);
  if (source.length === 0) {
    return { checkpoints: [] };
  }

  const outboundSamples: Record<number, NormalizedPoseGeometry[]> = {
    0: [],
    25: [],
    50: [],
    75: [],
    100: [],
  };
  const returnSamples: Record<number, NormalizedPoseGeometry[]> = {
    75: [],
    50: [],
    25: [],
    0: [],
  };

  for (const demo of source) {
    const { outbound, returning } = splitOutboundReturn(demo.trajectory, demo.apexMs);
    for (const progress of [0, 25, 50, 75, 100] as const) {
      outboundSamples[progress]!.push(sampleAtProgress(outbound, progress));
    }
    for (const progress of [75, 50, 25, 0] as const) {
      returnSamples[progress]!.push(sampleAtProgress(returning, 100 - progress));
    }
  }

  const checkpoints: CanonicalCheckpoint[] = [
    { index: 0, progress: 0, phase: "outbound", pose: medianGeometry(outboundSamples[0]!) },
    { index: 1, progress: 25, phase: "outbound", pose: medianGeometry(outboundSamples[25]!) },
    { index: 2, progress: 50, phase: "outbound", pose: medianGeometry(outboundSamples[50]!) },
    { index: 3, progress: 75, phase: "outbound", pose: medianGeometry(outboundSamples[75]!) },
    { index: 4, progress: 100, phase: "apex", pose: medianGeometry(outboundSamples[100]!) },
    { index: 5, progress: 75, phase: "return", pose: medianGeometry(returnSamples[75]!) },
    { index: 6, progress: 50, phase: "return", pose: medianGeometry(returnSamples[50]!) },
    { index: 7, progress: 25, phase: "return", pose: medianGeometry(returnSamples[25]!) },
    { index: 8, progress: 0, phase: "return", pose: medianGeometry(returnSamples[0]!) },
  ];

  return { checkpoints };
}
