import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import type { CanonicalMovement } from "../../src/frontend/pose/pose.types";
import type { evaluateLearnerVideo } from "../../src/scripts/level-b/runMovementValidation";

test("diagnostic frozen reference through the production learner streaming path", async ({ page }) => {
  test.skip(process.env.MOVEMENT_PRODUCTION_PROBE !== "1", "Explicit diagnostic; does not certify teacher compilation");
  const canonicalPath = "test-results/movement/anchor-regions/compiled-frozen.json";
  const frozen = JSON.parse(fs.readFileSync(canonicalPath, "utf8")) as {
    sets: { browser: { canonical: CanonicalMovement } };
  };
  const template = JSON.parse(fs.readFileSync("test-results/movement/3d/browser-movement-batched/teacher-cycle.json", "utf8")) as { lesson: Lesson };
  const lesson: Lesson = { ...template.lesson, canonicalMovement: frozen.sets.browser.canonical };
  await page.addInitScript(() => {
    (window as unknown as { cameraCalls: number }).cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { cameraCalls: number }).cameraCalls++;
      throw new Error("Upload must not request a camera");
    };
  });
  await page.goto("/");
  for (const matchDifficulty of [20, 50, 75, 80, 100]) {
    const result = await page.evaluate(async ({ lesson, matchDifficulty }) => {
      const schemaPath = "/src/frontend/lesson/LessonSchema.ts";
      const { LessonSchema } = await import(schemaPath) as typeof import("../../src/frontend/lesson/LessonSchema");
      LessonSchema.parse(lesson);
      const modulePath = "/src/scripts/level-b/runMovementValidation.ts";
      const mod = await import(modulePath) as { evaluateLearnerVideo: typeof evaluateLearnerVideo };
      return mod.evaluateLearnerVideo("/videos/test-squat-student_1.mp4", lesson, matchDifficulty);
    }, { lesson, matchDifficulty });
    const artifact = {
      diagnosticOnly: true,
      note: "Frozen source-backed reference; not a successful automatic teacher compile or a replacement matcher.",
      canonicalSha256: createHash("sha256").update(fs.readFileSync(canonicalPath)).digest("hex"),
      ...result,
    };
    fs.writeFileSync(`test-results/movement/final-generic/production-learner-${matchDifficulty}.json`, JSON.stringify(artifact));
    expect(result.summary.termination).toBe("eof");
    expect(result.evaluationEvents).toBe(1);
    expect((result.calibration as Record<string, number> | null)?.rewindMs).toBe(0);
    expect(result.summary.frames).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBe(0);
    console.log(JSON.stringify({ ...result.summary, calibration: result.calibration, evaluationEvents: result.evaluationEvents }));
  }
});
