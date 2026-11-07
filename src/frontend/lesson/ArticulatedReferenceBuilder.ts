import {
  ARTICULATED_REPRESENTATION,
  ARTICULATED_TOLERANCE,
  articulatedDistance,
  usableArticulated,
} from "../../shared/movement/ArticulatedBody";
import type {
  CanonicalMovement,
  Demonstration,
  MovementKind,
  MovementReference,
  NormalizedPose,
} from "../pose/pose.types";
import { selectArticulatedTargets } from "./ArticulatedTargets";

export function articulatedArc(path: NormalizedPose[]) {
  const arc = [0];
  for (let i = 1; i < path.length; i++)
    arc.push(
      arc[i - 1]! + articulatedDistance(path[i - 1]!.articulated3d!, path[i]!.articulated3d!).worst,
    );
  return arc;
}

export function buildArticulatedReference(demo: Demonstration): MovementReference {
  const indices = demo.trajectory
    .map((p, i) => (usableArticulated(p.articulated3d) ? i : -1))
    .filter((i) => i >= 0);
  const path = indices.map((i) => demo.trajectory[i]!);
  const reasons: string[] = [];
  if (path.length < 3) reasons.push("At least three reliable observed poses are required");
  if (demo.trajectory.some((p) => p.bodySkeleton || p.body3d || !p.articulated3d))
    reasons.push("Mixed or absent articulated geometry");
  if (
    path.some(
      (p, i) =>
        i > 0 &&
        (p.timestampMs <= path[i - 1]!.timestampMs ||
          p.timestampMs - path[i - 1]!.timestampMs > 1000),
    )
  )
    reasons.push("Tracking gap or non-monotonic observations; trim/re-record");
  const arc = articulatedArc(path),
    excursion = path.length
      ? Math.max(
          ...path.map((p) => articulatedDistance(path[0]!.articulated3d!, p.articulated3d!).worst),
        )
      : 0;
  if (excursion < ARTICULATED_TOLERANCE / 2)
    reasons.push("Insufficient articulated movement beyond the fixed tolerance");
  const selected = selectArticulatedTargets(path);
  if (selected.length < 3) reasons.push("At least three distinct geometric states are required");
  const samples = reasons.length
    ? []
    : selected.map((s) => ({ progress01: s.progress01, phase: s.phase, pose: s.pose }));
  const anchors = samples.length
    ? [
        { ...samples[0]!, id: "start" as const, holdMs: 0 },
        { ...samples.at(-1)!, id: "completion" as const, holdMs: 0 },
      ]
    : [];
  return {
    demonstrationId: demo.id,
    teacherConfirmed: demo.teacherConfirmed,
    alignmentEligible: !reasons.length,
    sourceTrajectory: demo.trajectory,
    samples,
    anchors,
    rejectionReason: reasons.length ? reasons.join("; ") : undefined,
    articulatedEvidence: {
      sourceIndices: selected.map((s) => indices[s.sourceIndex]!),
      arcLength: arc.at(-1) ?? 0,
      excursion,
      rejectionReasons: reasons,
    },
  };
}

export function buildArticulatedMovement(
  demos: Demonstration[],
  kind: MovementKind,
  draft = false,
): CanonicalMovement {
  const sources = demos.filter(
    (d) =>
      (d.classification === "good" && d.teacherConfirmed) ||
      (draft && d.classification === "unknown"),
  );
  const references = sources.map(buildArticulatedReference),
    preview = references.find((r) => r.alignmentEligible);
  if (!preview)
    throw new Error(
      `No coherent articulated execution: ${references.map((r) => r.rejectionReason).join("; ") || "confirm one execution"}`,
    );
  return {
    schemaVersion: 3,
    representation: ARTICULATED_REPRESENTATION,
    kind,
    references,
    samples: preview.samples,
    anchors: preview.anchors,
    trajectorySource: "coherent_3d_references",
    articulatedTolerance: ARTICULATED_TOLERANCE,
    checkpoints: [0, 0.25, 0.5, 0.75, 1].map((p, index) => ({
      index,
      progress: (p * 100) as 0 | 25 | 50 | 75 | 100,
      phase: "sequence",
      pose: preview.samples.reduce((a, b) =>
        Math.abs(a.progress01 - p) <= Math.abs(b.progress01 - p) ? a : b,
      ).pose,
    })),
  };
}
