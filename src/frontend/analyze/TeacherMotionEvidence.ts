import { poseDistance } from "../pose/PoseDistance";
import type { MovementKind, NormalizedPose, ObservedAnchorRegion, ReferenceQuality } from "../pose/pose.types";

export const isReliableBodyPose = (pose: NormalizedPose) => Boolean(pose.bodySkeleton?.orientationReliable &&
  pose.bodySkeleton.boneConfidence.filter((c) => c >= 0.5).length >= 6);

function quantile(values: number[], fraction: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? 0;
}

/** Scalar statistics only: all anchor geometry remains an observed source pose. */
export function inspectTeacherMotion(path: NormalizedPose[], kind: MovementKind) {
  const reliable = path.map((pose, sourceIndex) => ({ pose, sourceIndex })).filter(({ pose }) => isReliableBodyPose(pose));
  const intervals = path.slice(1).map((p, i) => p.timestampMs - path[i]!.timestampMs);
  const nominalIntervalMs = quantile(intervals.filter((dt) => dt > 0), 0.5);
  const steps = reliable.slice(1).map((r, i) => poseDistance(reliable[i]!.pose, r.pose));
  const speeds = steps.map((d, i) => d * 1000 / Math.max(1, reliable[i + 1]!.pose.timestampMs - reliable[i]!.pose.timestampMs));
  const stableSpeed = quantile(speeds, 0.35);
  // Boundary-connected neighborhoods cannot relabel an interior pause as an endpoint.
  const startCenter = 0;
  const completionCenter = reliable.length - 1;
  const first = reliable[startCenter]?.pose;
  const excursions = reliable.map(({ pose }) => first ? poseDistance(first, pose) : Infinity);
  const excursion = Math.max(0, ...excursions.slice(startCenter,completionCenter + 1).filter(Number.isFinite));
  const quality: ReferenceQuality = { regions: {}, sourceSamples: path.length, reliableSamples: reliable.length,
    nominalIntervalMs, excursion, regionRadius: Math.min(excursion * 0.2, Math.max(1e-6, quantile(steps, 0.5) * 2)),
    stableSpeed, largestConfidenceGapMs: 0, gaps: [], rejectionReasons: [] };
  if (intervals.some((dt) => dt <= 0)) quality.rejectionReasons.push("Non-monotonic source timestamps");
  for (const [boundary, observed, missing] of [
    [0, reliable[0]?.sourceIndex, reliable[0]?.sourceIndex],
    [path.length - 1, reliable.at(-1)?.sourceIndex, reliable.length ? path.length - 1 - reliable.at(-1)!.sourceIndex : undefined],
  ]) {
    if (observed === undefined || !missing || boundary === undefined) continue;
    const before = Math.min(boundary, observed), after = Math.max(boundary, observed);
    const dt = path[after]!.timestampMs - path[before]!.timestampMs;
    quality.largestConfidenceGapMs = Math.max(quality.largestConfidenceGapMs, dt);
    quality.gaps.push({ beforeSourceIndex: before, afterSourceIndex: after, durationMs: dt, missingSamples: missing,
      distance: null, coherent: dt <= 500, reason: "Unobserved boundary outside the reliable reference; no geometry inferred" });
  }
  for (let i = 1; i < reliable.length; i++) {
    const before = reliable[i - 1]!, after = reliable[i]!;
    const dt = after.pose.timestampMs - before.pose.timestampMs;
    const missing = after.sourceIndex - before.sourceIndex - 1;
    if (missing || dt > nominalIntervalMs * 2.5) {
      const d = steps[i - 1]!;
      // No interpolation: only short gaps with geometrically consistent endpoints survive.
      const coherent = dt <= 1000 && Number.isFinite(d) && d <= Math.max(quality.regionRadius, quantile(steps, 0.75) * 2);
      quality.largestConfidenceGapMs = Math.max(quality.largestConfidenceGapMs, dt);
      quality.gaps.push({ beforeSourceIndex: before.sourceIndex, afterSourceIndex: after.sourceIndex, durationMs: dt,
        missingSamples: missing, distance: Number.isFinite(d) ? d : null, coherent,
        reason: coherent ? "Short confidence gap; observed endpoints support continuity" : "Long or geometrically ambiguous confidence gap" });
    }
    if (!Number.isFinite(steps[i - 1]!)) quality.rejectionReasons.push("Adjacent reliable poses lack six common reliable bones");
  }
  if (quality.gaps.some((g) => !g.coherent)) quality.rejectionReasons.push("Unresolved confidence continuity");
  if (reliable.length < (kind === "cycle" ? 7 : 4)) quality.rejectionReasons.push("Insufficient reliable ordered motion");
  if (excursion < 0.25) quality.rejectionReasons.push("Insufficient geometric excursion");
  // A supported local extremum, rather than the largest isolated detector spike.
  let apex = startCenter;
  let apexScore = -Infinity;
  for (let i = startCenter + 1; i < completionCenter; i++) {
    const score = quantile(excursions.slice(i - 1,i + 2),0.5);
    if (score > apexScore) { apex = i; apexScore = score; }
  }
  const region = (center: number, lower: number, upper: number): ObservedAnchorRegion | undefined => {
    if (!reliable[center]) return undefined;
    let lo = center, hi = center;
    const supported = (i: number, neighbor: number) => reliable[Math.max(i, neighbor)]!.pose.timestampMs - reliable[Math.min(i, neighbor)]!.pose.timestampMs <= 500 &&
      poseDistance(reliable[center]!.pose, reliable[i]!.pose) <= quality.regionRadius;
    while (lo > lower && supported(lo - 1, lo)) lo--;
    while (hi < upper && supported(hi + 1, hi)) hi++;
    const rows = reliable.slice(lo, hi + 1);
    let diameter = 0;
    for (const a of rows) for (const b of rows) {
      const d = poseDistance(a.pose, b.pose);
      if (Number.isFinite(d)) diameter = Math.max(diameter, d);
      else quality.rejectionReasons.push("Anchor region lacks common reliable geometry");
    }
    return { startSourceIndex: rows[0]!.sourceIndex, endSourceIndex: rows.at(-1)!.sourceIndex,
      startMs: rows[0]!.pose.timestampMs, endMs: rows.at(-1)!.pose.timestampMs,
      samples: rows.map((r) => r.pose), diameter, maximumSpeed: Math.max(0, ...speeds.slice(lo, hi).filter(Number.isFinite)) };
  };
  const start = region(startCenter, 0, kind === "cycle" ? apex - 1 : completionCenter - 1);
  const turnaround = kind === "cycle" ? region(apex, 1, reliable.length - 2) : undefined;
  const completion = region(completionCenter, kind === "cycle" ? apex + 1 : startCenter + 1, reliable.length - 1);
  quality.regions = { start, turnaround, completion };
  if (start && completion && (start.endSourceIndex >= completion.startSourceIndex ||
      turnaround && (start.endSourceIndex >= turnaround.startSourceIndex || turnaround.endSourceIndex >= completion.startSourceIndex))) {
    quality.rejectionReasons.push("Semantic regions overlap or lack source ordering");
  }
  const namedRegions: Array<[string, ObservedAnchorRegion | undefined]> = [["start", start], ["completion", completion]];
  if (kind === "cycle") namedRegions.push(["turnaround", turnaround]);
  for (const [name, r] of namedRegions) {
    if (!r || r.samples.length < 2 || r.endMs <= r.startMs) quality.rejectionReasons.push(`Insufficient observed ${name} region (needs multiple reliable samples)`);
  }
  if (kind === "cycle" && reliable.length) {
    if (apex - startCenter < 3 || completionCenter - apex < 3) quality.rejectionReasons.push("Turnaround lacks ordered outbound/return evidence");
    const last = reliable[completionCenter]!.pose;
    const closure = start && completion ? Math.min(...start.samples.flatMap((a) => completion.samples.map((b) => poseDistance(a,b)))) : Infinity;
    if (closure > 0.25 * 1.25) quality.rejectionReasons.push("Completion does not return to the observed start region");
    if (poseDistance(reliable[apex]!.pose, last) < excursion * 0.5) quality.rejectionReasons.push("Insufficient return excursion");
    if (steps.slice(startCenter, apex).filter((d) => Number.isFinite(d) && d > 1e-4).length < 3 ||
        steps.slice(apex, completionCenter).filter((d) => Number.isFinite(d) && d > 1e-4).length < 3) quality.rejectionReasons.push("Insufficient distinct ordered phase observations");
  }
  quality.rejectionReasons = [...new Set(quality.rejectionReasons)];
  return { quality, reliable, start, turnaround, completion, apex, startCenter, completionCenter };
}
