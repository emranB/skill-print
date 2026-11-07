import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { comparePose } from "../../frontend/pose/PoseComparator";
import { poseDistance } from "../../frontend/pose/PoseDistance";
import { computeBodyScale, normalizePose } from "../../frontend/pose/PoseNormalizer";
import { hipMidpoint, hipWidth, shoulderWidth, torsoLength, jointAngle } from "../../frontend/pose/PoseGeometry";
import { isUsablePose, usabilityFloor } from "../../frontend/pose/PoseUsability";
import { sampleCanonical } from "../../frontend/lesson/RuntimeTargets";
import { ABLATIONS, diagnosticSimilarity, instrumentReplay, jointErrors, orderedPrefix, statistics, GROUPS } from "./generalizationDiagnostics";
import type { Lesson } from "../../frontend/lesson/lesson.types";
import type { CanonicalSample, Demonstration, NormalizedPoseGeometry, PoseFrame } from "../../frontend/pose/pose.types";
import type { RuntimeConfig } from "../../shared/config/config.types";

const OUT = path.resolve("test-results/movement/generalization");
fs.mkdirSync(OUT, { recursive: true });
const acceptedInput = (name: string) => {
  const snapshot = path.join(OUT, "accepted-baseline", name);
  return fs.existsSync(snapshot) ? snapshot : path.join("test-results/movement", name);
};
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2));
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? productionFiles(path.join(directory, d.name)) : [path.join(directory, d.name)]);
}
const manifest = Object.fromEntries([...productionFiles("src/frontend"), ...productionFiles("src/backend"), ...productionFiles("src/shared"), "config.json"].map((file) => [file.replaceAll("\\", "/"), hash(file)]));
write("production-before.json", manifest);
const teacherInput = acceptedInput("teacher-cycle.json");
const learnerInput = acceptedInput("position-75.json");
const teacher = read(teacherInput) as { lesson: Lesson; analysis: { poseRecording: { frames: PoseFrame[] } } };
const raw = read(learnerInput) as { frames: PoseFrame[]; trace: Array<{ currentProgressPercent: number }>; summary: { maximumProgressPercent: number; reps: number }; calibration: { windowStartMs: number } };
const config = read("config.json") as RuntimeConfig;
if (config.pose.leniency !== 0.25 || (config.pose.angleWeight ?? 0) !== 0 || config.pose.matchDifficulty !== 75) throw new Error("Accepted baseline config differs; no override permitted");
const canonical = teacher.lesson.canonicalMovement;
const samples = canonical.samples!;
const required = comparePose(samples[0]!.pose, samples[0]!.pose, { ...config.pose, trackingValid: true }).requiredSimilarity;
const require = createRequire(import.meta.url);
const probePath = (require("ffprobe-static") as { path: string }).path;
const metadata = (file: string) => JSON.parse(execFileSync(probePath, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,duration", "-of", "json", file], { encoding: "utf8" }));
write("provenance.json", { generatedAt: new Date().toISOString(), config, requiredSimilarity: required,
  sourceFiles: ["data/lesson-squat.mp4", "videos/test-squat-student_1.mp4", teacherInput, learnerInput].map((file) => ({ file, sha256: hash(file) })),
  teacherMetadata: metadata("data/lesson-squat.mp4"), studentMetadata: metadata("videos/test-squat-student_1.mp4"),
  source: "Recorded MediaPipe VIDEO poses from the accepted POSITION-75 baseline; no new learner pipeline or inference", productionUnchanged: true });
fs.copyFileSync(teacherInput, path.join(OUT, "teacher-input.json"));
fs.copyFileSync(learnerInput, path.join(OUT, "student-input.json"));

// Manual contact-sheet annotations only. No matcher, normalizer, or tracker receives these labels.
const attempts = [{ id: "front_1", view: "front", fromMs: 9000, toMs: 14000 }, { id: "front_2", view: "front", fromMs: 14000, toMs: 18000 },
  { id: "side_3", view: "side", fromMs: 23000, toMs: 28000 }, { id: "side_4", view: "side", fromMs: 28000, toMs: 33000 }];
function annotation(ms: number) {
  const attempt = attempts.find((a) => ms >= a.fromMs && ms < a.toMs);
  return { region: attempt ? `${attempt.view}_squat` : ms >= 33000 ? "exit" : "setup_walking", attemptId: attempt?.id ?? null };
}
write("annotations.json", { method: "Manual inspection of 1-second contact sheet; boundaries approximate (about +/- 0.5 s), reporting only",
  correction: "Earlier broad 3-18 s front and 18-31 s side bins included long standing/turning intervals and omitted part of the fourth return", attempts });
const frames = raw.frames.filter((f) => isUsablePose(f.landmarks, usabilityFloor(config.pose.minimumVisibility)));
const poses = frames.map((f) => normalizePose(f, config.pose.minimumVisibility));
const rows = frames.map((f, i) => ({ index: i, timestampMs: f.timestampMs, ...annotation(f.timestampMs) }));
const replay = instrumentReplay(canonical, raw.frames, config.pose, 75);
if (replay.observations.length !== raw.trace.length || replay.observations.some((r, i) => Math.abs(r.afterProgress * 100 - raw.trace[i]!.currentProgressPercent) > 1e-9)) {
  throw new Error("Replay differs from accepted raw trace; stop rather than reinterpret another baseline");
}

const matrices = Object.fromEntries(ABLATIONS.map((ablation) => [ablation, poses.map((p) => samples.map((s) => diagnosticSimilarity(p, s.pose, config.pose.minimumVisibility, ablation)))]));
const base = matrices.existing_12_joint_xy!;
const bestIndex = (scores: Array<number | null>) => scores.reduce<number>((best, score, i) => score !== null && score > (scores[best] ?? -Infinity) ? i : best, 0);
const best = (scores: Array<number | null>) => scores.every((s) => s === null)
  ? { progress01: null, similarity: null, phase: null }
  : { progress01: samples[bestIndex(scores)]!.progress01, similarity: scores[bestIndex(scores)], phase: samples[bestIndex(scores)]!.phase };
const apexColumn = samples.findIndex((s) => s.progress01 === 0.5);
for (const ablation of ABLATIONS) {
  const scores = matrices[ablation]!;
  write(`matrix-${ablation}.json`, { schemaVersion: 1, ablation, referenceSimilarity: required,
    scoreNote: ablation === "normalized_joint_angles" ? "1 - mean absolute projected angle error / 180; reference cutoff is NOT equivalent to POSITION tolerance; >=3 chains required" : "Unchanged POSITION mapping 1 - mean normalized joint distance / 1.25 (or a diagnostic penalty)",
    columns: samples.map((s, column) => ({ column, progress01: s.progress01, phase: s.phase })), rows, similarities: scores });
  fs.writeFileSync(path.join(OUT, `matrix-${ablation}.csv`), [
    ["timestampMs", "region", "attemptId", ...samples.map((s) => s.progress01)].join(","),
    ...rows.map((r, i) => [r.timestampMs, r.region, r.attemptId ?? "", ...scores[i]!.map((s) => s === null ? "" : s.toPrecision(12))].join(",")),
  ].join("\n"));
}

const ablations = ABLATIONS.map((ablation) => ({ ablation, attempts: attempts.map((attempt) => {
  const indices = rows.flatMap((r, i) => r.attemptId === attempt.id ? [i] : []);
  const matrix = indices.map((i) => matrices[ablation]![i]!);
  const prefix = orderedPrefix(matrix, required);
  const maxAtColumn = (j: number) => {
    const values = matrix.map((r) => r[j]).filter((s): s is number => s !== null && s !== undefined);
    return values.length ? Math.max(...values) : null;
  };
  const maxima = samples.map((_, j) => maxAtColumn(j));
  const matched = samples.filter((_, j) => maxima[j] !== null && maxima[j]! >= required);
  const bestRows = matrix.map(best);
  const kneeAngles = indices.map((i) => ({ index: i, angle: jointAngle(poses[i]!.landmarks, 23, 25, 27) }));
  const bottom = kneeAngles.reduce((a, b) => (b.angle ?? Infinity) < (a.angle ?? Infinity) ? b : a, kneeAngles[0]!);
  const bottomMs = frames[bottom.index]!.timestampMs;
  const physicalPhaseMatrix = matrix.map((row, j) => row.map((score, column) => {
    const ms = frames[indices[j]!]!.timestampMs;
    const progress = samples[column]!.progress01;
    const inPhase = progress < 0.5 ? ms <= bottomMs : progress === 0.5 ? Math.abs(ms - bottomMs) <= 500 : ms >= bottomMs;
    return inPhase ? score : null;
  }));
  const physicalPrefix = orderedPrefix(physicalPhaseMatrix, required);
  return { id: attempt.id, view: attempt.view, frames: matrix.length,
    orderedPrefixProgress: prefix.lastColumn < 0 ? null : samples[prefix.lastColumn]!.progress01,
    coherentFullOrderedCoverageAtReference: prefix.complete, orderedWitnessStudentRowIndices: prefix.witnessRows.map((i) => i < 0 ? null : indices[i]),
    physicalPhaseOrderedCoverage: physicalPrefix.complete,
    physicalPhasePrefixProgress: physicalPrefix.lastColumn < 0 ? null : samples[physicalPrefix.lastColumn]!.progress01,
    apexSimilarityWithinObservedBottomBand: statistics(matrix.flatMap((row, j) => Math.abs(frames[indices[j]!]!.timestampMs - bottomMs) <= 500 ? [row[apexColumn] ?? NaN] : [])).max,
    maxUnorderedCanonicalProgressAtReference: matched.at(-1)?.progress01 ?? null,
    maxMatchedOutboundProgress: matched.filter((s) => s.progress01 <= 0.5).at(-1)?.progress01 ?? null,
    maxStartSimilarity: maxAtColumn(0), maxApexSimilarity: maxAtColumn(apexColumn), maxCompletionSimilarity: maxAtColumn(samples.length - 1),
    apexSimilarityAtObservedBottom: matrices[ablation]![bottom.index]![apexColumn],
    bottomFrame: { timestampMs: frames[bottom.index]!.timestampMs, projectedLeftKneeDegrees: bottom.angle,
      method: "Minimum observed projected left-knee angle within manually observed attempt; diagnostic locator, not technique ground truth" },
    allBestSimilarity: statistics(bestRows.map((r) => r.similarity ?? NaN)), angleMissingCells: matrix.flat().filter((s) => s === null).length,
    bestProgressSeries: indices.map((i, j) => ({ timestampMs: frames[i]!.timestampMs, ...bestRows[j] })),
    canonicalColumnMaximumSimilarities: maxima };
}) }));
write("ablations.json", { requiredSimilarityReference: required, coherenceDefinition: "Optimistic monotonic coverage of every dense canonical sample in order, including start/apex/completion. Allows waits/multiple samples per frame; no local window or holds, no rep awards. Failure even here cannot be fixed merely by expanding the tracker window.",
  physicalPhaseDefinition: "Additional reporting-only constraint: outbound before the observed bottom, apex within +/-500 ms (contact-sheet precision), return after bottom. Still no hold or repetition scoring; angle cutoff is not POSITION-equivalent.",
  angleOnlyCaution: "Angle score/reference is a predeclared diagnostic scale, not optimized or equivalent to POSITION acceptance", results: ablations });

write("negative-regions.json", { note: "Independent matrix coverage, NOT tracker repetitions. These intervals include walking, standing and turning; no negative labels enter production.",
  results: ABLATIONS.map((ablation) => ({ ablation, regions: [{ id: "initial_setup", from: 0, to: 9000 }, { id: "turning_setup", from: 18000, to: 23000 }, { id: "exit", from: 33000, to: Infinity }].map((region) => {
    const indices = rows.flatMap((r, i) => r.timestampMs >= region.from && r.timestampMs < region.to ? [i] : []);
    const prefix = orderedPrefix(indices.map((i) => matrices[ablation]![i]!), required);
    return { id: region.id, frames: indices.length, optimisticFullOrderedCoverage: prefix.complete,
      orderedPrefixProgress: prefix.lastColumn < 0 ? null : samples[prefix.lastColumn]!.progress01,
      witnessTimestampMs: [0, apexColumn, samples.length - 1].map((j) => prefix.witnessRows[j]! >= 0 ? rows[indices[prefix.witnessRows[j]!]!]!.timestampMs : null) };
  }) })) });

const diagnostics = replay.observations.filter((r) => r.usable).map((r, i) => {
  const scores = base[i]!;
  const globalColumn = bestIndex(scores);
  const global = samples[globalColumn]!;
  const current = sampleCanonical(samples, r.currentTrackerProgress);
  const distance = poseDistance(current.pose, global.pose, { minimumVisibility: config.pose.minimumVisibility, planar: true, minimumJoints: 4 });
  return { ...r, ...annotation(r.timestampMs), globalBestDiagnosticOnly: { ...best(scores),
    accessConstraints: [global.progress01 < r.currentTrackerProgress ? "behind_current_progress" : null,
      global.progress01 > r.localUpperProgress ? "outside_local_progress_window" : null,
      global.progress01 > r.nextUnsatisfiedAnchor.progress01 ? "beyond_unsatisfied_anchor" : null,
      distance > 0.25 ? "outside_geometric_neighborhood" : null].filter(Boolean) },
    globalMaximumPassingCanonicalProgress: samples.filter((_, j) => scores[j]! >= required).at(-1)?.progress01 ?? null,
    globalBestBeyondBarrierBeforeApex: Math.max(...scores.filter((_, j) => samples[j]!.progress01 > replay.final.furthestProgressPercent / 100 + 1e-8 && samples[j]!.progress01 <= 0.5).map((s) => s ?? 0)),
    jointsAtGlobalBest: jointErrors(r.normalizedLearnerPose, global.pose, config.pose.minimumVisibility),
    jointsAtApex: jointErrors(r.normalizedLearnerPose, samples[apexColumn]!.pose, config.pose.minimumVisibility) };
});
write("frame-diagnostics.json", { matchDifficulty: 75, requiredSimilarity: required, frames: diagnostics });
fs.writeFileSync(path.join(OUT, "frame-diagnostics.ndjson"), diagnostics.map((r) => JSON.stringify(r)).join("\n"));
const parity = [20, 50, 75, 80, 100].map((difficulty) => {
  const r = difficulty === 75 ? replay : instrumentReplay(canonical, raw.frames, config.pose, difficulty);
  return { difficulty, final: r.final, incompleteReason: r.incompleteReason,
    trace: r.observations.map((p) => ({ timestampMs: p.timestampMs, progress: p.afterProgress, bestLocalCandidateProgress: p.bestLocalCandidateProgress,
      bestLocalSimilarity: p.similarityForBestLocalCandidate, rejectionReasons: p.exactRejectionReasons, productionReason: p.productionReason })) };
});
write("difficulty-replay.json", { source: "Identical recorded frames at every difficulty, not five different inference runs", results: parity });

const maximum = replay.final.furthestProgressPercent / 100;
const barrierFirst = diagnostics.findIndex((r) => Math.abs(r.afterProgress - maximum) < 1e-9);
const barrierRows = diagnostics.slice(barrierFirst + 1);
write("barrier.json", { progress01: maximum, firstReachedTimestampMs: diagnostics[barrierFirst]!.timestampMs,
  lastAcceptedBeforeBarrier: diagnostics.slice(0, barrierFirst + 1).filter((r) => r.progressionAccepted).at(-1),
  surroundingFrames: diagnostics.filter((r) => Math.abs(r.timestampMs - diagnostics[barrierFirst]!.timestampMs) <= 1500),
  stalledFrames: barrierRows.length, maximumBestLocalSimilarityWhileStalled: Math.max(...barrierRows.map((r) => r.similarityForBestLocalCandidate)),
  maximumForwardLocalSimilarityWhileStalled: Math.max(...barrierRows.flatMap((r) => r.localCandidates.filter((c) => c.progress01 > maximum && c.eligibleByGeometry).map((c) => c.similarity))),
  goodGlobalLaterOutboundFrames: barrierRows.filter((r) => r.globalBestBeyondBarrierBeforeApex >= required).map((r) => ({ timestampMs: r.timestampMs, attemptId: r.attemptId, similarity: r.globalBestBeyondBarrierBeforeApex })),
  reasonCounts: Object.fromEntries([...new Set(barrierRows.flatMap((r) => r.exactRejectionReasons))].map((reason) => [reason, barrierRows.filter((r) => r.exactRejectionReasons.includes(reason)).length])),
  apexMaximumSimilarity: Math.max(...base.map((r) => r[apexColumn]!)) });

function sourceSample(demo: Demonstration, sample: CanonicalSample): NormalizedPoseGeometry {
  const outbound = demo.trajectory.filter((p) => p.timestampMs <= demo.apexMs!);
  const returning = demo.trajectory.filter((p) => p.timestampMs >= demo.apexMs!);
  const part = sample.progress01 <= 0.5 ? outbound : returning;
  const fraction = sample.progress01 <= 0.5 ? sample.progress01 * 2 : (sample.progress01 - 0.5) * 2;
  return part[Math.min(part.length - 1, Math.round(fraction * (part.length - 1)))]!;
}
const good = teacher.lesson.demonstrations.filter((d) => d.classification === "good" && d.teacherConfirmed);
const teacherSources = good.map((d) => samples.map((s) => sourceSample(d, s)));
function groupStatistics(pairs: Array<ReturnType<typeof jointErrors>>) {
  return Object.fromEntries(Object.entries(GROUPS).map(([group, indices]) => {
    const joints = pairs.flatMap((p) => p.filter((j) => indices.includes(j.index)));
    const scored = joints.filter((j) => j.scored);
    return [group, { distances: statistics(scored.map((j) => j.distance!)), similarityLossContributions: statistics(scored.map((j) => j.similarityLossContribution)),
      eligible: scored.length, excluded: joints.length - scored.length,
      studentVisibility: statistics(joints.map((j) => j.studentVisibility)), teacherVisibility: statistics(joints.map((j) => j.teacherVisibility)) }];
  }));
}
const teacherPhasePairs = teacherSources.flatMap((source) => source.map((p, j) => jointErrors(p, samples[j]!.pose, config.pose.minimumVisibility)));
const sourceSummary = teacherSources.map((source, i) => {
  const selfScores = source.map((p, j) => diagnosticSimilarity(p, samples[j]!.pose, config.pose.minimumVisibility, "existing_12_joint_xy")!);
  const studentMatrix = poses.map((p) => source.map((target) => diagnosticSimilarity(p, target, config.pose.minimumVisibility, "existing_12_joint_xy")));
  return { demonstrationId: good[i]!.id, startMs: good[i]!.startMs, apexMs: good[i]!.apexMs, endMs: good[i]!.endMs,
    selfPhaseAlignedSimilarity: statistics(selfScores), phaseAlignedSamplesBelowRequired: selfScores.filter((s) => s < required).length,
    apexSimilarityToMedian: selfScores[apexColumn], studentAttempts: attempts.map((a) => {
      const m = studentMatrix.filter((_, j) => rows[j]!.attemptId === a.id); const prefix = orderedPrefix(m, required);
      return { id: a.id, orderedPrefixProgress: prefix.lastColumn < 0 ? null : samples[prefix.lastColumn]!.progress01,
        coherentFullOrderedCoverage: prefix.complete, maximumApexSimilarity: Math.max(...m.map((r) => r[apexColumn]!)) };
    }) };
});
write("teacher-self-match.json", { directCanonicalIdentity: statistics(samples.map((s) => diagnosticSimilarity(s.pose, s.pose, config.pose.minimumVisibility, "existing_12_joint_xy")!)),
  sourceTeacherPhaseAligned: statistics(teacherSources.flatMap((source) => source.map((p, j) => diagnosticSimilarity(p, samples[j]!.pose, config.pose.minimumVisibility, "existing_12_joint_xy")!))),
  demos: sourceSummary, groups: groupStatistics(teacherPhasePairs),
  note: "All six originally confirmed teacher sources are compared, not a selected fixture-specific teacher. Same phase/index resampling as the accepted builder; no new production canonical." });
write("teacher-anchor-audit.json", { note: "Projected knee minima are diagnostic locators only, not a proposed generic apex detector. Source timing/view labels require teacher review; no anchors or canonical samples were changed.",
  demos: good.map((d) => {
    const minimum = d.trajectory.map((p) => ({ timestampMs: p.timestampMs, degrees: jointAngle(p.landmarks, 23, 25, 27), visibility: Math.min(...[23, 25, 27].map((j) => p.landmarks[j]!.visibility ?? 0)) }))
      .filter((p) => p.degrees !== null && p.visibility >= config.pose.minimumVisibility).reduce<{ timestampMs: number; degrees: number | null; visibility: number } | null>((a, b) => !a || b.degrees! < a.degrees! ? b : a, null);
    const apex = d.trajectory.find((p) => p.timestampMs === d.apexMs);
    return { id: d.id, startMs: d.startMs, storedApexMs: d.apexMs, endMs: d.endMs, visibleProjectedKneeMinimum: minimum,
      storedApexProjectedLeftKneeDegrees: apex ? jointAngle(apex.landmarks, 23, 25, 27) : null,
      deltaMinimumToStoredApexMs: minimum ? minimum.timestampMs - d.apexMs! : null };
  }) });
const studentPhasePairs = ablations[0]!.attempts.flatMap((a) => {
  const indices = rows.flatMap((r, i) => r.attemptId === a.id ? [i] : []);
  const bottom = indices.findIndex((i) => frames[i]!.timestampMs === a.bottomFrame.timestampMs);
  return indices.map((i, j) => {
    const progress = j <= bottom ? 0.5 * j / Math.max(1, bottom) : 0.5 + 0.5 * (j - bottom) / Math.max(1, indices.length - 1 - bottom);
    return jointErrors(poses[i]!, sampleCanonical(samples, progress).pose, config.pose.minimumVisibility);
  });
});
write("joint-statistics.json", { teacherPhaseAligned: groupStatistics(teacherPhasePairs),
  studentDiagnosticPhaseAligned: groupStatistics(studentPhasePairs),
  studentGlobalBestAll: groupStatistics(diagnostics.map((r) => r.jointsAtGlobalBest)),
  studentGlobalBestAttempts: groupStatistics(diagnostics.filter((r) => r.attemptId).map((r) => r.jointsAtGlobalBest)),
  studentCurrentTarget: groupStatistics(diagnostics.map((r) => r.jointsAtCurrentTarget)),
  studentBestLocalWhileStalled: groupStatistics(barrierRows.map((r) => r.jointsAtBestLocalCandidate)),
  atObservedBottom: ablations[0]!.attempts.map((a) => ({ id: a.id, timestampMs: a.bottomFrame.timestampMs,
    jointsAtApex: diagnostics.find((r) => r.timestampMs === a.bottomFrame.timestampMs)!.jointsAtApex })),
  phaseAlignedCaution: "Student phase/index split uses its own observed knee-angle minimum, not teacher time or independent expert technique labels" });

const canonicalRealism = samples.map((sample, j) => {
  const distances = teacherSources.map((s) => poseDistance(sample.pose, s[j]!, { minimumVisibility: config.pose.minimumVisibility, planar: true, minimumJoints: 4 }));
  const anySourceDistances = good.map((d) => Math.min(...d.trajectory.map((p) => poseDistance(sample.pose, p, { minimumVisibility: config.pose.minimumVisibility, planar: true, minimumJoints: 4 }))));
  const bones = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]].map(([a, b]) => {
    const length = (p: NormalizedPoseGeometry) => Math.hypot(p.landmarks[a!]!.x - p.landmarks[b!]!.x, p.landmarks[a!]!.y - p.landmarks[b!]!.y);
    const lengths = teacherSources.map((s) => length(s[j]!));
    return { from: a, to: b, canonicalLength: length(sample.pose), sourceMin: Math.min(...lengths), sourceMax: Math.max(...lengths),
      outsideSourceRange: length(sample.pose) < Math.min(...lengths) - 1e-6 || length(sample.pose) > Math.max(...lengths) + 1e-6 };
  });
  return { progress01: sample.progress01, phase: sample.phase, nearestPhaseAlignedSourceDistance: Math.min(...distances),
    nearestAnySourceDistance: Math.min(...anySourceDistances), phaseAlignedSourceDistances: distances, bones };
});
write("canonical-realism.json", { samples: canonicalRealism, nearestSourceDistances: statistics(canonicalRealism.map((r) => r.nearestAnySourceDistance)),
  phaseAlignedDistances: statistics(canonicalRealism.map((r) => r.nearestPhaseAlignedSourceDistance)),
  samplesWithBoneOutsidePhaseSourceRange: canonicalRealism.filter((r) => r.bones.some((b) => b.outsideSourceRange)).length,
  note: "Off-source interpolation or a limb outside the source range is a warning, not proof of anatomical impossibility; visibility and phase alignment also matter" });

function features(frame: PoseFrame, student = true) {
  const p = frame.landmarks; const scale = computeBodyScale(p); const origin = hipMidpoint(p); const normalized = normalizePose(frame);
  const torso = torsoLength(p);
  const bones = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]].map(([a, b]) => ({
    from: a, to: b, visibility: Math.min(p[a!]!.visibility ?? 0, p[b!]!.visibility ?? 0),
    normalizedXYLength: Math.hypot(p[a!]!.x - p[b!]!.x, p[a!]!.y - p[b!]!.y) / scale,
    lengthOverTorso: Math.hypot(p[a!]!.x - p[b!]!.x, p[a!]!.y - p[b!]!.y) / torso,
  }));
  return { timestampMs: frame.timestampMs, ...(student ? annotation(frame.timestampMs) : { region: "teacher_source", attemptId: null }), rawScale: scale, torsoLength: torso,
    shoulderWidth: shoulderWidth(p), hipWidth: hipWidth(p), origin,
    normalizedHipOrigin: hipMidpoint(normalized.landmarks), shoulderWidthOverTorso: shoulderWidth(p) / torso,
    hipWidthOverTorso: hipWidth(p) / torso, bones, worldLandmarksAvailable: frame.worldLandmarks.length === 33 };
}
const studentFeatures = frames.map((f) => features(f));
const teacherFeatures = teacher.analysis.poseRecording.frames.map((f) => features(f, false));
write("normalization-features.json", { student: studentFeatures, teacher: teacherFeatures,
  studentByRegion: ["setup_walking", "front_squat", "side_squat", "exit"].map((region) => {
    const selected = studentFeatures.filter((f) => f.region === region);
    return { region, rawScale: statistics(selected.map((f) => f.rawScale)), shoulderWidthOverTorso: statistics(selected.map((f) => f.shoulderWidthOverTorso)),
      hipWidthOverTorso: statistics(selected.map((f) => f.hipWidthOverTorso)), bones: studentFeatures[0]!.bones.map((b, j) => ({ from: b.from, to: b.to,
        normalizedXYLength: statistics(selected.filter((f) => f.bones[j]!.visibility >= config.pose.minimumVisibility).map((f) => f.bones[j]!.normalizedXYLength)) })) };
  }),
  teacherByDemonstration: good.map((d) => { const f = teacherFeatures.filter((f) => f.timestampMs >= d.startMs && f.timestampMs <= d.endMs);
    return { demonstrationId: d.id, startMs: d.startMs, endMs: d.endMs, rawScale: statistics(f.map((f) => f.rawScale)),
      shoulderWidthOverTorso: statistics(f.map((f) => f.shoulderWidthOverTorso)), hipWidthOverTorso: statistics(f.map((f) => f.hipWidthOverTorso)) }; }),
  learnerCalibration: raw.calibration, teacherCalibration: teacher.lesson.teacherCalibration,
  note: "Frame normalization recomputes scale/origin per frame, without using a calibration scale. Projected bone lengths confound anthropometry, posture, and viewpoint; no true limb-proportion claim is inferred." });

// Algebraic control: same-aspect-ratio uniform image scaling/translation should disappear under the accepted normalizer.
const controls = frames.map((frame) => {
  const transformed = { ...frame, landmarks: frame.landmarks.map((p) => ({ ...p, x: p.x * 0.6 + 0.1, y: p.y * 0.6 + 0.2, z: p.z * 0.6 + 0.05 })) };
  return poseDistance(normalizePose(frame), normalizePose(transformed), { minimumVisibility: config.pose.minimumVisibility, planar: false });
});
write("normalization-controls.json", { scaleTranslationDistance: statistics(controls),
  note: "Synthetic algebraic invariance control, not a new inference or learner success claim; actual view rotations are not equivalent to uniform scale/translation" });

const summary = { frames: frames.length, canonicalSamples: samples.length, matrixCellsPerAblation: frames.length * samples.length,
  requiredSimilarity: required, replay: replay.final, baselineParity: true,
  barrierTimestampMs: diagnostics[barrierFirst]!.timestampMs, ablations: ablations.map((r) => ({ ablation: r.ablation, attempts: r.attempts.map(({ id, orderedPrefixProgress, coherentFullOrderedCoverageAtReference, maxMatchedOutboundProgress, maxApexSimilarity, apexSimilarityAtObservedBottom }) =>
    ({ id, orderedPrefixProgress, coherentFullOrderedCoverageAtReference, maxMatchedOutboundProgress, maxApexSimilarity, apexSimilarityAtObservedBottom })) })),
  teacherSelfPhaseAligned: statistics(teacherSources.flatMap((source) => source.map((p, j) => diagnosticSimilarity(p, samples[j]!.pose, config.pose.minimumVisibility, "existing_12_joint_xy")!))),
  canonicalNearestSource: statistics(canonicalRealism.map((r) => r.nearestAnySourceDistance)) };
const changed = Object.keys(manifest).filter((file) => hash(file) !== manifest[file]);
if (changed.length) throw new Error(`Production files changed during diagnostics: ${changed.join(", ")}`);
write("production-after.json", manifest);
write("summary.json", { ...summary, productionFilesUnchanged: true });
console.log(JSON.stringify(summary, null, 2));
