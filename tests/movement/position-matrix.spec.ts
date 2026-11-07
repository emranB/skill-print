import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
const root = process.env.MOVEMENT_VALIDATION_ROOT
  ? `${process.env.MOVEMENT_VALIDATION_ROOT}/regression`
  : "test-results/movement";

test("articulated teacher compile, self replay and learner difficulty matrix", async ({ page }) => {
  const angleWeight = Number(process.env.MOVEMENT_ANGLE_WEIGHT ?? 0);
  const prefix = angleWeight ? "position-angles" : "position";
  for (const file of [
    "data/lesson-squat.mp4",
    "data/lesson-dance.mp4",
    "videos/test-squat-student_1.mp4",
  ])
    expect(fs.existsSync(file)).toBe(true);
  fs.mkdirSync(root, { recursive: true });
  await page.addInitScript(() => {
    const w = window as unknown as { __cameraCalls: number };
    w.__cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      w.__cameraCalls++;
      throw new Error("Upload must not open camera");
    };
  });
  await page.goto("/");
  let squat: Lesson | undefined;
  for (const [url, kind] of [
    ["/data/lesson-squat.mp4", "cycle"],
    ["/data/lesson-dance.mp4", "sequence"],
  ] as const) {
    fs.mkdirSync(`${root}/articulated-v1`, { recursive: true });
    const cached = `${root}/articulated-v1/product-teacher-${kind}.json`;
    const hash = createHash("sha256");
    for (const file of [
      url.slice(1),
      "config.json",
      "src/frontend/lesson/CanonicalMovementBuilder.ts",
      "src/frontend/lesson/ReferenceMovementBuilder.ts",
      "src/frontend/analyze/SequenceAnalyzer.ts",
      "src/frontend/analyze/SessionAnalyzer.ts",
      "src/frontend/analyze/CycleAnalyzer.ts",
      "src/frontend/analyze/VideoPoseExtractor.ts",
      "src/frontend/pose/RTMW3DPoseDetector.ts",
      "src/frontend/pose/PoseNormalizer.ts",
      "src/frontend/pose/PoseDistance.ts",
      "src/movement/skeleton.py",
      "src/movement/worker.py",
      "requirements-movement.txt",
      "requirements-movement-adapter.txt",
      "src/shared/movement/HeavyBody.ts",
      "src/shared/movement/OAS.ts",
      "src/shared/movement/heavySchema.ts",
      "src/frontend/pose/PoseDetector.ts",
      "src/frontend/lesson/HeavyReferenceBuilder.ts",
      "src/frontend/analyze/HeavySegmentation.ts",
      "src/frontend/learn/HeavyProgressTracker.ts",
      "public/models/pose_landmarker_heavy.task",
      "src/shared/movement/ArticulatedBody.ts",
      "src/frontend/lesson/ArticulatedReferenceBuilder.ts",
      "src/frontend/learn/ArticulatedProgressTracker.ts",
      "src/frontend/learn/CompletedMovementScorer.ts",
      "src/frontend/lesson/ArticulatedTargets.ts",
      "src/frontend/learn/AlignedMovementQuality.ts",
    ])
      hash.update(fs.readFileSync(file));
    const sourceFingerprint = hash.digest("hex");
    const previous = fs.existsSync(cached) ? JSON.parse(fs.readFileSync(cached, "utf8")) : null;
    const result =
      previous?.sourceFingerprint === sourceFingerprint
        ? (previous as Awaited<
            ReturnType<
              (typeof import("../../src/scripts/level-b/runMovementValidation"))["compileTeacherFixture"]
            >
          >)
        : await page.evaluate(
            async ({ url, kind }) => {
              const modulePath = "/src/scripts/level-b/runMovementValidation.ts";
              const mod = (await import(
                modulePath
              )) as typeof import("../../src/scripts/level-b/runMovementValidation");
              return mod.compileTeacherFixture(url, kind);
            },
            { url, kind },
          );
    fs.writeFileSync(cached, JSON.stringify({ ...result, sourceFingerprint }));
    expect(result.lesson.canonicalMovement.samples!.length).toBeGreaterThanOrEqual(3);
    expect(result.targetCounts[100]).toBe(20);
    expect(result.lesson.canonicalMovement.representation).toBe("mediapipe-articulated-3d-v1");
    expect(
      result.lesson.canonicalMovement.references!.every(
        (r) => !r.alignmentEligible || r.samples.every((s) => s.pose.articulated3d),
      ),
    ).toBe(true);
    expect(result.lesson.canonicalMovement.kind).toBe(kind);
    const selfReplay = await page.evaluate(async (lesson) => {
      const modulePath = "/src/frontend/learn/ArticulatedProgressTracker.ts";
      const { ArticulatedProgressTracker } = (await import(
        modulePath
      )) as typeof import("../../src/frontend/learn/ArticulatedProgressTracker");
      return [20, 50, 75, 80, 100].flatMap((difficulty) =>
        lesson.canonicalMovement
          .references!.filter((r) => r.alignmentEligible)
          .map((reference) => {
            const tracker = new ArticulatedProgressTracker(
              {
                ...lesson.canonicalMovement,
                references: [reference],
                samples: reference.samples,
                anchors: reference.anchors,
              },
              difficulty,
            );
            const events = reference.sourceTrajectory
              .map((p) => tracker.update(p))
              .filter((e) => e?.type === "REP_SUCCESS" || e?.type === "SEQUENCE_COMPLETE");
            return { difficulty, referenceId: reference.demonstrationId, events };
          }),
      );
    }, result.lesson);
    fs.writeFileSync(
      `${root}/articulated-v1/product-self-${kind}.json`,
      JSON.stringify(selfReplay, null, 2),
    );
    expect(selfReplay.length).toBeGreaterThan(0);
    for (const replay of selfReplay)
      expect(replay.events).toEqual([
        { type: kind === "cycle" ? "REP_SUCCESS" : "SEQUENCE_COMPLETE" },
      ]);
    if (kind === "cycle") squat = result.lesson;
    else {
      expect(result.lesson.canonicalMovement.anchors!.map((a) => a.id)).toEqual([
        "start",
        "completion",
      ]);
      expect(result.analysis.demonstrations.every((d) => d.apexMs === undefined)).toBe(true);
    }
  }
  const matrix = [];
  for (const matchDifficulty of [20, 50, 75, 80, 100]) {
    const result = await page.evaluate(
      async ({ lesson, matchDifficulty, angleWeight }) => {
        const modulePath = "/src/scripts/level-b/runMovementValidation.ts";
        const mod = (await import(
          modulePath
        )) as typeof import("../../src/scripts/level-b/runMovementValidation");
        return mod.evaluateLearnerVideo(
          "/videos/test-squat-student_1.mp4",
          lesson,
          matchDifficulty,
          angleWeight,
        );
      },
      { lesson: squat!, matchDifficulty, angleWeight },
    );
    fs.writeFileSync(`${root}/${prefix}-${matchDifficulty}.json`, JSON.stringify(result));
    matrix.push({
      ...result.summary,
      calibration: result.calibration,
      evaluationEvents: result.evaluationEvents,
    });
    fs.writeFileSync(`${root}/${prefix}-matrix.json`, JSON.stringify(matrix, null, 2));
    expect(result.summary.termination).toBe("eof");
    expect(result.evaluationEvents).toBe(1);
    expect((result.calibration as Record<string, number> | null)?.rewindMs).toBe(0);
    expect(result.summary.frames).toBeGreaterThan(0);
    console.log(JSON.stringify(result.summary));
  }
  expect(
    await page.evaluate(() => (window as unknown as { __cameraCalls: number }).__cameraCalls),
  ).toBe(0);
  await page.screenshot({ path: path.resolve(`${root}/browser.png`) });
});
