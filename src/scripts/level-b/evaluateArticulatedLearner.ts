import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  articulatedBody,
  usableArticulated,
  BONE_NAMES,
  BEND_NAMES,
} from "../../shared/movement/ArticulatedBody";
import { ArticulatedProgressTracker } from "../../frontend/learn/ArticulatedProgressTracker";
import {
  compactExecution,
  scoreCompletedMovement,
} from "../../frontend/learn/CompletedMovementScorer";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";
import type { PoseFrame } from "../../frontend/pose/pose.types";
import type { Lesson } from "../../frontend/lesson/lesson.types";

const final = process.argv.includes("--final");
const root = final
    ? (process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/final-mvp")
    : "test-results/movement/articulated-v1",
  stream = process.argv.includes("--stream");
const frozen = fs.readFileSync(`${root}/frozen-teacher.json`, "utf8"),
  freeze = JSON.parse(fs.readFileSync(`${root}/freeze.json`, "utf8")) as { sha256: string };
if (createHash("sha256").update(frozen).digest("hex") !== freeze.sha256)
  throw new Error("Teacher freeze changed");
const { lesson } = JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`, "utf8")) as {
  lesson: Lesson;
};
if (final) {
  const frozenValue = JSON.parse(frozen) as { lesson: Lesson; fileHashes: Record<string, string> };
  if (JSON.stringify(lesson) !== JSON.stringify(frozenValue.lesson))
    throw new Error("Fresh persisted lesson changed");
  for (const [file, sha] of Object.entries(frozenValue.fileHashes))
    if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== sha)
      throw new Error(`Matching constants/source changed: ${file}`);
  if (!stream) throw new Error("Final learner validation requires fresh production stream");
}
const windows = [
  { name: "front-1", start: 9000, end: 14000 },
  { name: "front-2", start: 14000, end: 18000 },
  { name: "side-1", start: 23000, end: 28000 },
  { name: "side-2", start: 28000, end: 33000 },
];
const negatives = [
  { name: "setup-walking", start: 0, end: 9000 },
  { name: "turn-standing", start: 18000, end: 23000 },
  { name: "exit", start: 33000, end: Infinity },
];
function replay(frames: PoseFrame[], difficulty: number) {
  const tracker = new ArticulatedProgressTracker(lesson.canonicalMovement, difficulty),
    events: unknown[] = [],
    reasons: Record<string, number> = {};
  for (const f of frames) {
    const event = tracker.update(normalizePose(f));
    const diagnostic = tracker.diagnostics();
    reasons[diagnostic.reason] = (reasons[diagnostic.reason] ?? 0) + 1;
    if (event?.type === "REP_SUCCESS") events.push({ timestampMs: f.timestampMs, ...diagnostic });
  }
  const diagnostic = tracker.diagnostics();
  const completedCandidates = diagnostic.completedCandidates.map((candidate) => {
    const tolerance = lesson.canonicalMovement.articulatedTolerance!;
    const rejectionReasons: string[] = [];
    const worst = candidate.worstFeature as {
      kind: string;
      index: number;
      distance: number;
    } | null;
    if (!candidate.accepted) {
      if (typeof candidate.distance !== "number" || !Number.isFinite(candidate.distance))
        rejectionReasons.push("insufficient_common_geometry_or_alignment");
      if (Number(candidate.unsupportedStage) > tolerance)
        rejectionReasons.push("unsupported_teacher_stage_exceeds_fixed_angular_tolerance");
      if (worst && worst.distance > tolerance)
        rejectionReasons.push("mean_feature_error_exceeds_fixed_angular_tolerance");
      if (Number(candidate.meanPoseDistance) > tolerance)
        rejectionReasons.push("mean_pose_error_exceeds_fixed_angular_tolerance");
    }
    return {
      ...candidate,
      rejectionReasons,
      worstFeatureName: worst
        ? (worst.kind === "bone" ? BONE_NAMES : BEND_NAMES)[worst.index]
        : null,
      worstFeatureDegrees: worst ? worst.distance * 180 : null,
    };
  });
  return {
    reps: events.length,
    events,
    reasons,
    ...diagnostic,
    completedCandidateCount: completedCandidates.length,
    completedCandidates,
  };
}
const results = [20, 50, 75, 80, 100].map((difficulty) => {
  const input = JSON.parse(
    fs.readFileSync(
      stream
        ? `${root}/learner-stream-${difficulty}.json`
        : "test-results/movement/heavy-v1/learner-75.json",
      "utf8",
    ),
  ) as { frames: PoseFrame[]; summary?: unknown; wallMs?: number; calibration?: unknown };
  const frames = stream
    ? input.frames
    : input.frames.map((f) => {
        const { body3d: _historical, bodySkeleton: _rtmw, ...raw } = f;
        return { ...raw, articulated3d: articulatedBody(f.worldLandmarks, f.landmarks) };
      });
  const segment = (w: { name: string; start: number; end: number }) => {
    const rows = frames.filter((f) => f.timestampMs >= w.start && f.timestampMs < w.end);
    const supported = rows.filter((f) => usableArticulated(f.articulated3d));
    const scores = lesson.canonicalMovement
      .references!.filter((r) => r.alignmentEligible)
      .map((r) => ({
        referenceId: r.demonstrationId,
        ...scoreCompletedMovement(
          supported.map(normalizePose),
          compactExecution(r.sourceTrajectory).map((p) => p.articulated3d!),
        ),
      }));
    const best = [...scores].sort((a, b) => a.distance - b.distance)[0];
    return {
      ...w,
      observations: rows.length,
      supportedObservations: supported.length,
      natural: replay(rows, difficulty),
      wholeWindow: best,
      allReferences: scores,
    };
  };
  return {
    difficulty,
    frames: frames.length,
    summary: input.summary,
    wallMs: input.wallMs,
    calibration: input.calibration,
    full: replay(frames, difficulty),
    attempts: windows.map(segment),
    negatives: negatives.map(segment),
  };
});
fs.writeFileSync(
  `${root}/learner-${stream ? "stream" : "cached-world"}-validation.json`,
  JSON.stringify(
    {
      frozenSha256: freeze.sha256,
      provenance: stream
        ? "New actual production Heavy VIDEO streaming"
        : "Same cached actual Heavy VIDEO world observations at difficulty75, transformed by new production descriptor; not fresh model inference",
      results,
    },
    null,
    2,
  ),
);
if (final) {
  for (const result of results) {
    if (
      result.negatives.some((n) => n.natural.reps !== 0) ||
      result.full.events.some((event) => {
        const time = (event as { timestampMs: number }).timestampMs;
        return negatives.some((n) => time >= n.start && time < n.end);
      })
    )
      throw new Error(
        `Negative full completion at difficulty ${result.difficulty}; raw evidence preserved`,
      );
  }
}
console.log(
  JSON.stringify(
    results.map((r) => ({
      difficulty: r.difficulty,
      reps: r.full.reps,
      max: r.full.furthestProgressPercent,
      attempts: r.attempts.map((a) => ({
        name: a.name,
        reps: a.natural.reps,
        max: a.natural.furthestProgressPercent,
        distance: a.wholeWindow?.distance,
        worst: a.wholeWindow?.worstFeature,
      })),
      negatives: r.negatives.map((n) => ({
        name: n.name,
        reps: n.natural.reps,
        max: n.natural.furthestProgressPercent,
      })),
    })),
    null,
    2,
  ),
);
