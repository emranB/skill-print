import { comparePose } from "../../frontend/pose/PoseComparator";
import { poseDistance, poseSimilarity } from "../../frontend/pose/PoseDistance";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import { JOINT_NAMES, MAJOR_JOINTS, isUsablePose, usabilityFloor } from "../../frontend/pose/PoseUsability";
import { measureAngleErrors } from "../../frontend/pose/PoseAngles";
import { ProgressTracker, FORWARD_WINDOW_PROGRESS, GEOMETRY_NEIGHBORHOOD_RADIUS, GEOMETRIC_PLATEAU_EPSILON } from "../../frontend/learn/ProgressTracker";
import { buildRuntimeTargets, interpolateGeometry, sampleCanonical } from "../../frontend/lesson/RuntimeTargets";
import type { CanonicalMovement, NormalizedPoseGeometry, NormalizedPose, PoseFrame } from "../../frontend/pose/pose.types";
import type { ProgressTrackerOptions } from "../../frontend/learn/ProgressTracker";

export const GROUPS = { shoulders: [11, 12], elbows: [13, 14], wrists: [15, 16], hips: [23, 24], knees: [25, 26], ankles: [27, 28] };
const LOWER = [23, 24, 25, 26, 27, 28];
const TORSO_LOWER = [11, 12, ...LOWER];
const MATCH_IMPROVEMENT = 0.00001; // Mirrors the frozen tracker; replay parity is asserted for every frame.

export function jointErrors(student: NormalizedPoseGeometry, target: NormalizedPoseGeometry, floor: number, indices = MAJOR_JOINTS, planar = true) {
  const count = indices.filter((i) => student.landmarks[i] && target.landmarks[i] &&
    (student.landmarks[i]!.visibility ?? 0) >= floor && (target.landmarks[i]!.visibility ?? 0) >= floor).length;
  return indices.map((index) => {
    const a = student.landmarks[index]; const b = target.landmarks[index];
    const scored = Boolean(a && b && (a.visibility ?? 0) >= floor && (b.visibility ?? 0) >= floor);
    const dx = a && b ? a.x - b.x : null; const dy = a && b ? a.y - b.y : null;
    const dz = a && b ? a.z - b.z : null;
    const distance = dx === null || dy === null || dz === null ? null : Math.hypot(dx, dy, planar ? 0 : dz);
    return { index, name: JOINT_NAMES[index], scored, studentVisibility: a?.visibility ?? 0, teacherVisibility: b?.visibility ?? 0,
      dx, dy, dz, distance, meanDistanceContribution: scored ? distance! / count : 0,
      similarityLossContribution: scored ? distance! / count / 1.25 : 0 };
  });
}

export function mirrorPose(pose: NormalizedPoseGeometry, reflect = true, swap = true): NormalizedPoseGeometry {
  const landmarks = pose.landmarks.map((p) => ({ ...p, x: reflect ? -p.x : p.x }));
  if (swap) for (const [a, b] of Object.values(GROUPS)) [landmarks[a]!, landmarks[b]!] = [landmarks[b]!, landmarks[a]!];
  return { landmarks };
}

export const ABLATIONS = ["existing_12_joint_xy", "lower_body_xy", "torso_lower_xy", "remove_wrists_xy", "remove_elbows_wrists_xy",
  "normalized_joint_angles", "xy_reliable_lower_angles", "mirror_left_right_xy", "normalized_xyz", "swap_labels_only_xy", "reflect_x_only_xy"] as const;
export type Ablation = typeof ABLATIONS[number];

export function diagnosticSimilarity(student: NormalizedPoseGeometry, target: NormalizedPoseGeometry, floor: number, ablation: Ablation): number | null {
  if (ablation === "normalized_joint_angles") {
    const angles = measureAngleErrors(student, target, floor);
    // Diagnostic scale only: 1 - mean absolute degrees / 180. It is not a production tolerance.
    return angles.length < 3 ? null : 1 - angles.reduce((sum, a) => sum + a.errorDegrees, 0) / angles.length / 180;
  }
  const indices = ablation === "lower_body_xy" ? LOWER : ["torso_lower_xy", "remove_elbows_wrists_xy"].includes(ablation) ? TORSO_LOWER
    : ablation === "remove_wrists_xy" ? MAJOR_JOINTS.filter((i) => i !== 15 && i !== 16) : MAJOR_JOINTS;
  const pose = ablation === "mirror_left_right_xy" ? mirrorPose(student) : ablation === "swap_labels_only_xy" ? mirrorPose(student, false, true)
    : ablation === "reflect_x_only_xy" ? mirrorPose(student, true, false) : student;
  let similarity = poseSimilarity(pose, target, { minimumVisibility: floor, planar: ablation !== "normalized_xyz", indices });
  if (ablation === "xy_reliable_lower_angles") {
    const angles = measureAngleErrors(student, target, Math.max(0.8, floor)).filter((a) => /hip|knee/.test(a.name));
    // Same conservative maximum penalty as the prior diagnostic, not a production config change.
    if (angles.length >= 3) similarity = Math.max(0, similarity - 0.05 * angles.reduce((s, a) => s + Math.min(1, a.errorDegrees / 90), 0) / angles.length);
  }
  return similarity;
}

export function statistics(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  const q = (fraction: number) => n ? sorted[Math.floor((n - 1) * fraction)]! : null;
  return { n, min: q(0), mean: n ? sorted.reduce((a, b) => a + b, 0) / n : null, median: q(0.5), p95: q(0.95), max: q(1) };
}

/** An optimistic ORDERED matrix prefix: no local window, time/hold requirement, or repetition scoring. */
export function orderedPrefix(matrix: Array<Array<number | null>>, requiredSimilarity: number) {
  if (!matrix.length) return { lastColumn: -1, witnessRows: [] as number[], complete: false };
  const witnessRows = Array<number>(matrix[0]!.length).fill(-1);
  for (let i = 0; i < matrix.length; i++) for (let j = 0; j < witnessRows.length; j++) {
    if (witnessRows[j]! >= 0) continue;
    const score = matrix[i]![j];
    if (score !== null && score !== undefined && score >= requiredSimilarity && (j === 0 || witnessRows[j - 1]! >= 0)) witnessRows[j] = i;
  }
  const lastColumn = witnessRows.findIndex((r) => r < 0) - 1;
  const complete = witnessRows.every((r) => r >= 0);
  return { lastColumn: complete ? witnessRows.length - 1 : lastColumn, witnessRows, complete };
}

interface TrackerState {
  progress01: number; nextAnchor: number; holdSince: number | null; previousPose: NormalizedPose | null; lastTimestamp: number;
}

/** Read-only state observation plus an explanation of the unchanged local selection, never global production matching. */
export function instrumentReplay(canonical: CanonicalMovement, frames: PoseFrame[], options: ProgressTrackerOptions, difficulty = 75) {
  const samples = canonical.samples!;
  const targets = buildRuntimeTargets(canonical, difficulty);
  const tracker = new ProgressTracker(canonical, targets, options);
  const observations = frames.map((frame) => {
    const state = tracker as unknown as TrackerState;
    const before = { progress01: state.progress01, nextAnchor: state.nextAnchor, holdSince: state.holdSince, lastTimestamp: state.lastTimestamp };
    const previous = frame.timestampMs - state.lastTimestamp > 500 ? null : state.previousPose;
    const pose = normalizePose(frame, options.minimumVisibility);
    const usable = isUsablePose(frame.landmarks, usabilityFloor(options.minimumVisibility));
    const current = sampleCanonical(samples, before.progress01);
    const target = tracker.getGhostTarget()!;
    const anchor = canonical.anchors![before.nextAnchor]!;
    const upper = before.nextAnchor === 0 ? 0 : Math.min(before.progress01 + FORWARD_WINDOW_PROGRESS, anchor.progress01);
    const comparison = (sample: typeof current) => comparePose(pose, sample.pose, { ...options, trackingValid: usable });
    const candidates = samples.filter((s) => s.progress01 >= before.progress01 - 1e-8 && s.progress01 <= upper + 1e-8).map((sample) => ({
      sample, geometricDistanceFromCurrent: poseDistance(current.pose, sample.pose, { minimumVisibility: options.minimumVisibility, planar: true, minimumJoints: 4 }),
      comparison: comparison(sample),
    }));
    const eligible = candidates.filter((c) => c.geometricDistanceFromCurrent <= GEOMETRY_NEIGHBORHOOD_RADIUS);
    let best = current; let selected = comparison(current);
    const pathFailures: Array<{ candidateProgress: number; targetProgress: number; maximumSweptSimilarity: number }> = [];
    for (const candidate of eligible) {
      const result = candidate.comparison;
      const plateau = Math.abs(result.similarity - selected.similarity) <= MATCH_IMPROVEMENT &&
        poseDistance(best.pose, candidate.sample.pose, { minimumVisibility: options.minimumVisibility, planar: true, minimumJoints: 4 }) <= GEOMETRIC_PLATEAU_EPSILON;
      if (!(result.similarity > selected.similarity + MATCH_IMPROVEMENT || plateau)) continue;
      const blocked = targets.filter((t) => !t.anchor && t.progress01 > before.progress01 && t.progress01 < candidate.sample.progress01).find((t) => {
        const sweep = previous ? Array.from({ length: 9 }, (_, i) => interpolateGeometry(previous, pose, i / 8)) : [pose];
        const similarities = sweep.map((p) => comparePose(p, t.pose, { ...options, trackingValid: usable }));
        if (similarities.some((r) => r.passed)) return false;
        pathFailures.push({ candidateProgress: candidate.sample.progress01, targetProgress: t.progress01,
          maximumSweptSimilarity: Math.max(...similarities.map((r) => r.similarity)) });
        return true;
      });
      if (!blocked) { best = candidate.sample; selected = result; }
    }
    const rawBest = eligible.reduce((best, c) => c.comparison.similarity > best.comparison.similarity ? c : best,
      { sample: current, comparison: comparison(current), geometricDistanceFromCurrent: 0 });
    const anchorDistance = poseDistance(current.pose, anchor.pose, { minimumVisibility: options.minimumVisibility, planar: true, minimumJoints: 4 });
    const anchorAccessible = before.nextAnchor === 0 || (anchor.progress01 <= upper + 1e-8 && anchorDistance <= GEOMETRY_NEIGHBORHOOD_RADIUS);
    const event = tracker.update(pose, usable);
    const after = tracker.diagnostics();
    if (usable && Math.abs(tracker.lastSimilarity - selected.similarity) > 1e-12) throw new Error(`Diagnostic local selection drift at ${frame.timestampMs}`);
    const progressionAccepted = state.progress01 > before.progress01 || event?.type === "REP_SUCCESS";
    const anchorAccepted = state.nextAnchor !== before.nextAnchor || event?.type === "REP_SUCCESS";
    const rejectionReasons = progressionAccepted || anchorAccepted ? [] : !usable ? ["tracking_invalid"] : [
      ...(!selected.passed ? ["selected_local_similarity_below_required"] : []),
      ...(pathFailures.length ? ["better_candidate_intermediate_target_unsupported"] : []),
      ...(selected.passed && best.progress01 <= before.progress01 ? ["no_better_supported_forward_geometry"] : []),
      ...(anchorAccessible && comparison(anchor).passed ? ["semantic_anchor_continuous_hold_pending"] : []),
    ];
    return { timestampMs: frame.timestampMs, usable, normalizedLearnerPose: pose, currentTrackerProgress: before.progress01,
      currentPhase: current.phase, nextTargetPhase: target.phase, currentTargetProgress: target.progress01,
      bestLocalCandidateProgress: best.progress01, bestGeometricLocalCandidateProgress: rawBest.sample.progress01,
      similarityForCurrentTarget: comparison(target).similarity, similarityAtCurrentProgress: comparison(current).similarity,
      similarityForBestLocalCandidate: selected.similarity, similarityForBestGeometricLocalCandidate: rawBest.comparison.similarity,
      requiredSimilarity: selected.requiredSimilarity, localUpperProgress: upper, localCandidates: candidates.map((c) => ({
        progress01: c.sample.progress01, similarity: c.comparison.similarity, geometricDistanceFromCurrent: Number.isFinite(c.geometricDistanceFromCurrent) ? c.geometricDistanceFromCurrent : null,
        eligibleByGeometry: c.geometricDistanceFromCurrent <= GEOMETRY_NEIGHBORHOOD_RADIUS,
      })),
      progressionAccepted: Boolean(progressionAccepted), anchorAccepted: Boolean(anchorAccepted), exactRejectionReasons: rejectionReasons,
      productionReason: after.reason, afterProgress: state.progress01, event, pathFailures,
      nextUnsatisfiedAnchor: { id: anchor.id, progress01: anchor.progress01, accessible: anchorAccessible,
        snapshot: "before_update",
        similarity: comparison(anchor).similarity, geometricDistanceFromCurrent: Number.isFinite(anchorDistance) ? anchorDistance : null,
        holdRequiredMs: anchor.holdMs, holdSinceMs: state.nextAnchor === before.nextAnchor ? state.holdSince : null },
      nextUnsatisfiedAnchorAfterUpdate: canonical.anchors![state.nextAnchor]
        ? { id: canonical.anchors![state.nextAnchor]!.id, progress01: canonical.anchors![state.nextAnchor]!.progress01 }
        : null,
      jointsAtCurrentTarget: jointErrors(pose, target.pose, options.minimumVisibility),
      jointsAtBestLocalCandidate: jointErrors(pose, best.pose, options.minimumVisibility),
    };
  });
  return { observations, final: tracker.diagnostics(), incompleteReason: tracker.finish() };
}
