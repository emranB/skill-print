import { poseDistance } from "../pose/PoseDistance";
import { inspectTeacherMotion } from "../analyze/TeacherMotionEvidence";
import type { CanonicalMovement, CanonicalSample, Demonstration, MovementAnchor, MovementKind, MovementReference, NormalizedPose } from "../pose/pose.types";

function phaseSamples(path: NormalizedPose[], start: number, end: number, phase: CanonicalSample["phase"]): CanonicalSample[] {
  if (path.length < 2) throw new Error("A 3D phase requires at least two observed poses");
  const usable = (p: NormalizedPose) => Boolean(p.bodySkeleton?.orientationReliable && p.bodySkeleton.boneConfidence.filter((c) => c >= 0.5).length >= 6);
  if (!usable(path[0]!) || !usable(path[path.length - 1]!)) throw new Error("A semantic anchor needs reliable 3D geometry; review/re-record this demonstration");
  path = path.filter(usable);
  const lengths = [0];
  for (let i = 1; i < path.length; i++) {
    const distance = poseDistance(path[i - 1]!, path[i]!);
    if (!Number.isFinite(distance)) throw new Error("Unreliable 3D reference geometry; review the demonstration");
    lengths.push(lengths[i - 1]! + distance);
  }
  const total = lengths[lengths.length - 1]!;
  if (total < 1e-6) throw new Error("A 3D phase must contain observed movement");
  return path.map((pose, i) => ({ progress01: start + (end - start) * lengths[i]! / total, phase, pose }));
}

export function buildTeacherReference(demo: Demonstration, kind: MovementKind): MovementReference {
    if (demo.trajectory.some((p) => p.bodySkeleton?.representation !== "rtmw3d-body-v1")) throw new Error("Mixed/legacy geometry cannot be relabeled as RTMW3D");
    const path = demo.trajectory;
    const evidence = inspectTeacherMotion(path, kind);
    const metadata = { anchorConstruction: "observed-regions-v1" as const, quality: evidence.quality };
    try {
    if (evidence.quality.rejectionReasons.length) throw new Error(evidence.quality.rejectionReasons.join("; "));
    const firstIndex = evidence.reliable.findIndex((r) => r.sourceIndex === evidence.start!.startSourceIndex);
    const lastIndex = evidence.reliable.findIndex((r) => r.sourceIndex === evidence.completion!.endSourceIndex);
    const reliable = evidence.reliable.slice(firstIndex, lastIndex + 1).map((r) => r.pose);
    let samples: CanonicalSample[];
    if (kind === "sequence") samples = phaseSamples(reliable, 0, 1, "sequence");
    else {
      const outbound = reliable.slice(0, evidence.apex - firstIndex + 1);
      const returning = reliable.slice(evidence.apex - firstIndex);
      samples = [...phaseSamples(outbound, 0, 0.5, "outbound"), ...phaseSamples(returning, 0.5, 1, "return").slice(1)];
      samples.find((s) => Math.abs(s.progress01 - 0.5) < 1e-8)!.phase = "apex";
    }
    const anchors: MovementAnchor[] = [0, ...(kind === "cycle" ? [0.5] : []), 1].map((progress01, i) => ({
      ...samples.find((s) => Math.abs(s.progress01 - progress01) < 1e-8)!,
      id: i === 0 ? "start" : progress01 === 1 ? "completion" : "apex", holdMs: 0,
      region: i === 0 ? evidence.start : progress01 === 1 ? evidence.completion : evidence.turnaround,
    }));
    return { ...metadata, demonstrationId: demo.id, teacherConfirmed: demo.teacherConfirmed, alignmentEligible: true, samples, anchors, sourceTrajectory: path };
    } catch (error) {
      const rejectionReason = error instanceof Error ? error.message : "Unreliable reference";
      if (!evidence.quality.rejectionReasons.length) evidence.quality.rejectionReasons.push(rejectionReason);
      return { ...metadata, demonstrationId: demo.id, teacherConfirmed: demo.teacherConfirmed, alignmentEligible: false,
        rejectionReason, samples: [], anchors: [], sourceTrajectory: path };
    }
}

/** Keep every confirmed teacher execution; never combine coordinates across sources. */
export function buildReferenceMovement(demonstrations: Demonstration[], kind: MovementKind, draft = false): CanonicalMovement {
  const confirmed = demonstrations.filter((d) => d.teacherConfirmed && d.classification === "good");
  const sources = confirmed.length ? confirmed : draft ? demonstrations.filter((d) => d.classification === "unknown" && d.trajectory.length >= 2) : [];
  if (!sources.length) throw new Error("Confirm at least one good 3D demonstration before compiling");
  const references = sources.map((demo) => buildTeacherReference(demo, kind));
  // First confirmed source is only a preview. Alignment compares complete sources independently.
  const preview = references.find((r) => r.alignmentEligible);
  if (!preview) throw new Error("No demonstration has reliable 3D semantic anchors; review or re-record the movement");
  const positions = kind === "cycle" ? [0,.125,.25,.375,.5,.625,.75,.875,1] : [0,.25,.5,.75,1];
  const checkpoints = positions.map((p, index) => {
    const sample = preview.samples.reduce((a, b) => Math.abs(a.progress01 - p) <= Math.abs(b.progress01 - p) ? a : b);
    const progress = kind === "cycle" ? [0,25,50,75,100,75,50,25,0][index]! : p * 100;
    return { index, progress: progress as 0 | 25 | 50 | 75 | 100, phase: sample.phase, pose: sample.pose };
  });
  return { schemaVersion: 3, representation: "rtmw3d-body-v1", kind, references,
    trajectorySource: "coherent_3d_references", samples: preview.samples, anchors: preview.anchors,
    checkpoints };
}
