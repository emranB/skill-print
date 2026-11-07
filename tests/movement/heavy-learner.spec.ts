import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";

test("frozen Heavy teacher learner evaluation at every difficulty", async ({ page }) => {
  test.skip(process.env.MOVEMENT_HEAVY_LEARNER !== "1", "Explicit empirical learner run");
  const root = "test-results/movement/heavy-v1";
  const frozen = fs.readFileSync(`${root}/frozen-teacher.json`, "utf8");
  const freeze = JSON.parse(fs.readFileSync(`${root}/freeze.json`, "utf8")) as { sha256: string; teacherOnly: boolean };
  expect(createHash("sha256").update(frozen).digest("hex")).toBe(freeze.sha256);
  expect(freeze.teacherOnly).toBe(true);
  const teacher = JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`, "utf8")) as { lesson: Lesson; analysis: unknown };
  const canonical = teacher.lesson.canonicalMovement;
  expect(JSON.stringify({ representation: canonical.representation, calibration: canonical.statisticalCalibration,
    references: canonical.references, segmentation: teacher.analysis })).toBe(frozen);
  await page.addInitScript(() => {
    (window as unknown as { cameraCalls: number }).cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { cameraCalls: number }).cameraCalls++;
      throw new Error("Uploaded learner cannot request camera");
    };
  });
  const movementRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/movement")) movementRequests.push(request.url()); });
  await page.goto("/");
  for (const difficulty of [20, 50, 75, 80, 100]) {
    const started = Date.now();
    const result = await page.evaluate(async ({ lesson, difficulty }) => {
      const path = "/src/scripts/level-b/runMovementValidation.ts";
      const mod = await import(path) as typeof import("../../src/scripts/level-b/runMovementValidation");
      return mod.evaluateLearnerVideo("/videos/test-squat-student_1.mp4", lesson, difficulty);
    }, { lesson: teacher.lesson, difficulty });
    fs.writeFileSync(`${root}/learner-${difficulty}.json`, JSON.stringify({ ...result, frozenSha256: freeze.sha256, wallMs: Date.now() - started }));
    expect(result.summary.termination).toBe("eof");
    expect(result.evaluationEvents).toBe(1);
    expect((result.calibration as Record<string, number> | null)?.rewindMs).toBe(0);
    expect(result.summary.frames).toBeGreaterThan(0);
    console.log(JSON.stringify({ difficulty, reps: result.summary.reps, maximum: result.summary.maximumProgressPercent, frames: result.summary.frames }));
  }
  expect(movementRequests).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBe(0);
  expect(fs.readFileSync(`${root}/frozen-teacher.json`, "utf8")).toBe(frozen);
});
