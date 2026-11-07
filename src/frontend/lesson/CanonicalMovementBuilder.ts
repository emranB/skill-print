import { median } from "../../shared/utils/math";
import { buildReferenceMovement } from "./ReferenceMovementBuilder";
import { buildHeavyMovement } from "./HeavyReferenceBuilder";
import { buildArticulatedMovement } from "./ArticulatedReferenceBuilder";
import type {
  CanonicalCheckpoint,
  CanonicalMovement,
  Demonstration,
  NormalizedLandmark,
  NormalizedPose,
  NormalizedPoseGeometry,
  MovementKind,
  CanonicalSample,
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
export function buildCanonicalMovement(demonstrations: Demonstration[], kind: MovementKind = "cycle", draft = false): CanonicalMovement {
  if (demonstrations.some(d => d.trajectory.some(p => p.articulated3d))) return buildArticulatedMovement(demonstrations,kind,draft);
  if (demonstrations.some(d => d.trajectory.some(p => p.body3d))) return buildHeavyMovement(demonstrations,kind,draft);
  if (demonstrations.some((d) => d.trajectory.some((p) => p.bodySkeleton))) return buildReferenceMovement(demonstrations, kind, draft);
  const good = demonstrations.filter((d) => d.classification === "good" && d.teacherConfirmed);
  const source = good.length > 0 ? good : demonstrations.filter((d) => d.trajectory.length > 0);
  if (source.length === 0) {
    return { schemaVersion: 2, kind, samples: [], anchors: [], checkpoints: [] };
  }

  const paths = source.map((d) => kind === "sequence"
    ? [d.trajectory]
    : Object.values(splitOutboundReturn(d.trajectory, d.apexMs ?? d.trajectory[Math.floor(d.trajectory.length / 2)]!.timestampMs)));
  const samples: CanonicalSample[] = [];
  const phases = kind === "sequence" ? ["sequence" as const] : ["outbound" as const, "return" as const];
  phases.forEach((phase, part) => {
    const count = Math.max(101, ...paths.map((p) => p[part]!.length));
    for (let i = part === 0 ? 0 : 1; i < count; i += 1) {
      const fraction = i / (count - 1);
      const progress01 = kind === "sequence" ? fraction : (part + fraction) / 2;
      samples.push({ progress01, phase: kind === "cycle" && progress01 === 0.5 ? "apex" : phase,
        pose: medianGeometry(paths.map((p) => sampleAtProgress(p[part]!, fraction * 100))) });
    }
  });
  const anchorIndices = kind === "cycle" ? [0, samples.findIndex((s) => s.progress01 === 0.5), samples.length - 1] : [0, samples.length - 1];
  const anchors = anchorIndices.map((index, i) => ({ ...samples[index]!, id: (i === 0 ? "start" : i === anchorIndices.length - 1 ? "completion" : "apex") as "start" | "apex" | "completion", holdMs: 150 }));
  if (kind === "sequence") {
    return { schemaVersion: 2, kind, samples, anchors, trajectorySource: "dense_samples",
      checkpoints: [0, 25, 50, 75, 100].map((progress, index) => ({ index, progress: progress as 0 | 25 | 50 | 75 | 100, phase: "sequence", pose: samples[Math.round(progress / 100 * (samples.length - 1))]!.pose })) };
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
    const { outbound, returning } = splitOutboundReturn(demo.trajectory, demo.apexMs ?? demo.trajectory[Math.floor(demo.trajectory.length / 2)]!.timestampMs);
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

  return { schemaVersion: 2, kind, samples, anchors, trajectorySource: "dense_samples", checkpoints };
}
