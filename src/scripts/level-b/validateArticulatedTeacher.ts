import fs from "node:fs";
import { createHash } from "node:crypto";
import { articulatedBody, ARTICULATED_REPRESENTATION } from "../../shared/movement/ArticulatedBody";
import { buildArticulatedMovement } from "../../frontend/lesson/ArticulatedReferenceBuilder";
import { ArticulatedProgressTracker } from "../../frontend/learn/ArticulatedProgressTracker";
import { LessonSchema } from "../../frontend/lesson/LessonSchema";
import { buildRuntimeTargets } from "../../frontend/lesson/RuntimeTargets";
import {
  scoreCompletedMovement,
  compactExecution,
} from "../../frontend/learn/CompletedMovementScorer";
import type {
  CanonicalMovement,
  Demonstration,
  NormalizedPose,
  PoseFrame,
} from "../../frontend/pose/pose.types";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import { normalizePose } from "../../frontend/pose/PoseNormalizer";

const final = process.argv.includes("--final");
const root = final
  ? (process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/final-mvp")
  : "test-results/movement/articulated-v1";
fs.mkdirSync(root, { recursive: true });
function compile(kind: "cycle" | "sequence") {
  if (final) {
    const current = JSON.parse(fs.readFileSync(`${root}/teacher-${kind}.json`, "utf8")) as {
      lesson: Lesson;
    };
    LessonSchema.parse(current.lesson);
    if (
      current.lesson.canonicalMovement.representation !== ARTICULATED_REPRESENTATION ||
      current.lesson.canonicalMovement.kind !== kind
    )
      throw new Error("Wrong fresh persisted representation/kind");
    return {
      ...current,
      targetCounts: Object.fromEntries(
        [1, 20, 50, 75, 80, 99, 100].map((d) => [
          d,
          buildRuntimeTargets(current.lesson.canonicalMovement, d).length,
        ]),
      ),
    };
  }
  const previous = JSON.parse(
    fs.readFileSync(`test-results/movement/heavy-v1/teacher-${kind}.json`, "utf8"),
  ) as {
    lesson: Lesson;
    analysis: { poseRecording: { frames: PoseFrame[] }; demonstrations: Demonstration[] };
  };
  const frames = previous.analysis.poseRecording.frames.map((f) => {
    const { body3d: _historical, bodySkeleton: _rtmw, ...observed } = f;
    return { ...observed, articulated3d: articulatedBody(f.worldLandmarks, f.landmarks) };
  });
  // Diagnostic source boundaries only; production construction receives ordinary teacher executions.
  const demonstrations = previous.analysis.demonstrations
    .filter((d) => d.classification !== "fragment")
    .map((d) => ({
      ...d,
      classification: "good" as const,
      teacherConfirmed: true,
      trajectory: frames
        .filter((f) => f.timestampMs >= d.startMs && f.timestampMs <= d.endMs)
        .map(normalizePose),
    }));
  const canonicalMovement = buildArticulatedMovement(demonstrations, kind);
  const lesson = {
    ...previous.lesson,
    demonstrations,
    canonicalMovement,
    referencePose: demonstrations[0]!.trajectory[0]!,
  };
  LessonSchema.parse(lesson);
  const result = {
    lesson,
    frames,
    boundaryProvenance:
      "Section-24 teacher-only observed proposal boundaries reused diagnostically; no matching code receives fixture annotations",
    targetCounts: Object.fromEntries(
      [1, 20, 50, 75, 80, 99, 100].map((d) => [
        d,
        buildRuntimeTargets(canonicalMovement, d).length,
      ]),
    ),
  };
  fs.writeFileSync(`${root}/teacher-${kind}.json`, JSON.stringify(result));
  return result;
}
function replay(path: NormalizedPose[], canonical: CanonicalMovement, difficulty = 75) {
  const tracker = new ArticulatedProgressTracker(canonical, difficulty),
    events: unknown[] = [];
  for (const pose of path) {
    const event = tracker.update(pose);
    if (event?.type === "REP_SUCCESS" || event?.type === "SEQUENCE_COMPLETE")
      events.push({ event, timestampMs: pose.timestampMs, ...tracker.diagnostics() });
  }
  return { completions: events.length, events, ...tracker.diagnostics() };
}
const teacher = compile("cycle"),
  dance = compile("sequence"),
  canonical = teacher.lesson.canonicalMovement;
const eligible = canonical.references!.filter((r) => r.alignmentEligible);
const single = (index: number) => ({
  ...canonical,
  references: [eligible[index]!],
  samples: eligible[index]!.samples,
  anchors: eligible[index]!.anchors,
});
const self = Object.fromEntries(
  [20, 50, 75, 80, 100].map((d) => [
    d,
    eligible.map((r, i) => replay(r.sourceTrajectory, single(i), d)),
  ]),
);
const robustness = eligible.map((r, index) => {
  const p = r.sourceTrajectory;
  const half = Array.from(
    { length: Math.ceil(p.length / 2) },
    (_, i) => p[Math.round((i * (p.length - 1)) / (Math.ceil(p.length / 2) - 1))]!,
  );
  return {
    id: r.demonstrationId,
    half: replay(half, single(index)),
    normal: replay(p, single(index)),
    double: replay(
      p.flatMap((pose, i) => [
        pose,
        {
          ...pose,
          timestampMs:
            pose.timestampMs + (p[i + 1] ? (p[i + 1]!.timestampMs - pose.timestampMs) / 2 : 1),
        },
      ]),
      single(index),
    ),
    drops: replay(
      p.filter((_, i) => i % 7 !== 3),
      single(index),
    ),
    static: replay(
      p.map((v) => ({ ...p[0]!, timestampMs: v.timestampMs })),
      single(index),
    ),
    partial: replay(p.slice(0, Math.floor(p.length / 2)), single(index)),
  };
});
const matrix = eligible.map((row) =>
  eligible.map((_, j) => replay(row.sourceTrajectory, single(j))),
);
const distances = eligible.map((row) =>
  eligible.map((reference) =>
    scoreCompletedMovement(
      compactExecution(row.sourceTrajectory),
      compactExecution(reference.sourceTrajectory).map((p) => p.articulated3d!),
    ),
  ),
);
const dancePath = dance.lesson.canonicalMovement.references![0]!.sourceTrajectory;
const danceResult = {
  self: Object.fromEntries(
    [20, 50, 75, 80, 100].map((d) => [d, replay(dancePath, dance.lesson.canonicalMovement, d)]),
  ),
  reverse: replay(
    [...dancePath].reverse().map((p, i) => ({ ...p, timestampMs: i * 67 })),
    dance.lesson.canonicalMovement,
  ),
  repeat: replay(
    [
      ...dancePath,
      ...dancePath.map((p) => ({
        ...p,
        timestampMs: p.timestampMs + dancePath.at(-1)!.timestampMs + 1000,
      })),
    ],
    dance.lesson.canonicalMovement,
  ),
};
const benchmark: Record<string, unknown> = {};
const observed = final
  ? null
  : (JSON.parse(fs.readFileSync("test-results/movement/heavy-v1/teacher-cycle.json", "utf8")) as {
      analysis: { poseRecording: { frames: PoseFrame[] } };
    });
const descriptorTimings = (observed?.analysis.poseRecording.frames ?? []).map((frame) => {
  const started = performance.now();
  articulatedBody(frame.worldLandmarks, frame.landmarks);
  return performance.now() - started;
});
if (descriptorTimings.length)
  benchmark.descriptor = {
    samples: descriptorTimings.length,
    meanMs: descriptorTimings.reduce((s, v) => s + v, 0) / descriptorTimings.length,
    p95Ms: [...descriptorTimings].sort((a, b) => a - b)[
      Math.floor(descriptorTimings.length * 0.95)
    ],
  };
for (const [name, references] of [
  ["one", eligible.slice(0, 1)],
  ["all", eligible],
] as const) {
  const tracker = new ArticulatedProgressTracker({ ...canonical, references }, 100),
    timings: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    tracker.update({
      ...eligible[0]!.sourceTrajectory[i % eligible[0]!.sourceTrajectory.length]!,
      timestampMs: i * 67,
    });
    timings.push(performance.now() - t);
  }
  benchmark[name] = {
    references: references.length,
    meanMs: timings.reduce((s, v) => s + v, 0) / timings.length,
    p95Ms: timings.sort((a, b) => a - b)[190],
  };
}
const report = {
  representation: ARTICULATED_REPRESENTATION,
  tolerance: canonical.articulatedTolerance,
  targetCounts: teacher.targetCounts,
  references: canonical.references!.map((r) => ({
    id: r.demonstrationId,
    eligible: r.alignmentEligible,
    reason: r.rejectionReason,
    evidence: r.articulatedEvidence,
    samples: r.samples.length,
  })),
  self,
  robustness,
  matrix,
  distances,
  dance: danceResult,
  benchmark,
};
fs.writeFileSync(`${root}/teacher-validation.json`, JSON.stringify(report, null, 2));
const failures = Object.values(self).flatMap((rows) => rows.filter((r) => r.completions !== 1));
const temporalFailures = robustness.flatMap((r) =>
  ["half", "normal", "double", "drops"]
    .filter((k) => r[k as "half"].completions !== 1)
    .map((k) => ({ id: r.id, mode: k, ...r[k as "half"] })),
);
console.log(
  JSON.stringify(
    {
      eligible: eligible.length,
      self: Object.fromEntries(
        Object.entries(self).map(([d, rows]) => [d, rows.map((r) => r.completions)]),
      ),
      temporalFailures,
      matrix: matrix.map((row) => row.map((r) => r.completions)),
      dance: Object.fromEntries(
        Object.entries(danceResult.self).map(([d, r]) => [d, r.completions]),
      ),
      benchmark,
    },
    null,
    2,
  ),
);
if (
  failures.length ||
  temporalFailures.length ||
  !eligible.length ||
  Object.values(danceResult.self).some((r) => r.completions !== 1) ||
  danceResult.reverse.completions !== 0 ||
  danceResult.repeat.completions !== 1 ||
  robustness.some((r) => r.static.completions !== 0 || r.partial.completions !== 0)
)
  process.exitCode = 1;
else {
  const constantsFiles = [
    "src/frontend/lesson/ArticulatedTargets.ts",
    "src/frontend/learn/AlignedMovementQuality.ts",
    "src/frontend/learn/CompletedMovementScorer.ts",
    "src/shared/movement/ArticulatedBody.ts",
    "src/frontend/learn/ArticulatedProgressTracker.ts",
    "src/frontend/lesson/ArticulatedReferenceBuilder.ts",
    "src/frontend/lesson/RuntimeTargets.ts",
    "src/frontend/learn/LearningRun.ts",
    "src/frontend/pose/PoseDetector.ts",
    "src/frontend/pose/LivePoseLoop.ts",
    "src/frontend/learn/LearnerVideo.ts",
    "config.json",
  ];
  const fileHashes = Object.fromEntries(
    constantsFiles.map((file) => [
      file,
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    ]),
  );
  const frozen = JSON.stringify(
    final
      ? { lesson: teacher.lesson, fileHashes }
      : {
          representation: canonical.representation,
          tolerance: canonical.articulatedTolerance,
          references: canonical.references,
        },
  );
  fs.writeFileSync(`${root}/frozen-teacher.json`, frozen);
  fs.writeFileSync(
    `${root}/freeze.json`,
    JSON.stringify(
      {
        sha256: createHash("sha256").update(frozen).digest("hex"),
        createdAt: new Date().toISOString(),
        teacherOnly: true,
      },
      null,
      2,
    ),
  );
}
