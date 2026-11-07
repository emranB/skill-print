import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";

test("frozen articulated teacher actual learner streaming matrix", async ({ page }) => {
  const final = process.env.MOVEMENT_FINAL_VALIDATION === "1";
  test.skip(
    !final && process.env.MOVEMENT_ARTICULATED_LEARNER !== "1",
    "Explicit frozen empirical evaluation",
  );
  const root = final
      ? (process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/final-mvp")
      : "test-results/movement/articulated-v1",
    frozen = fs.readFileSync(`${root}/frozen-teacher.json`, "utf8");
  const freeze = JSON.parse(fs.readFileSync(`${root}/freeze.json`, "utf8")) as { sha256: string };
  expect(createHash("sha256").update(frozen).digest("hex")).toBe(freeze.sha256);
  const { lesson } = JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`, "utf8")) as {
    lesson: Lesson;
  };
  const frozenValue = JSON.parse(frozen) as {
    lesson?: Lesson;
    fileHashes?: Record<string, string>;
  };
  const verifyFreeze = () => {
    expect(fs.readFileSync(`${root}/frozen-teacher.json`, "utf8")).toBe(frozen);
    if (final) {
      expect(JSON.stringify(lesson)).toBe(JSON.stringify(frozenValue.lesson));
      for (const [file, sha] of Object.entries(frozenValue.fileHashes!))
        expect(createHash("sha256").update(fs.readFileSync(file)).digest("hex")).toBe(sha);
    }
  };
  if (!final)
    expect(
      JSON.stringify({
        representation: lesson.canonicalMovement.representation,
        tolerance: lesson.canonicalMovement.articulatedTolerance,
        references: lesson.canonicalMovement.references,
      }),
    ).toBe(frozen);
  verifyFreeze();
  await page.addInitScript(() => {
    (window as unknown as { cameraCalls: number }).cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { cameraCalls: number }).cameraCalls++;
      throw new Error("No upload camera");
    };
  });
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/movement")) requests.push(r.url());
  });
  await page.goto("/");
  for (const difficulty of [20, 50, 75, 80, 100]) {
    const start = Date.now();
    const result = await page.evaluate(
      async ({ lesson, difficulty }) => {
        const path = "/src/scripts/level-b/runMovementValidation.ts";
        const mod = (await import(
          path
        )) as typeof import("../../src/scripts/level-b/runMovementValidation");
        return mod.evaluateLearnerVideo("/videos/test-squat-student_1.mp4", lesson, difficulty);
      },
      { lesson, difficulty },
    );
    fs.writeFileSync(
      `${root}/learner-stream-${difficulty}.json`,
      JSON.stringify({ ...result, frozenSha256: freeze.sha256, wallMs: Date.now() - start }),
    );
    verifyFreeze();
    expect(result.summary.termination).toBe("eof");
    expect(result.evaluationEvents).toBe(1);
    expect((result.calibration as Record<string, number> | null)?.rewindMs).toBe(0);
    expect(result.frames.every((f) => f.articulated3d && !f.body3d && !f.bodySkeleton)).toBe(true);
    console.log(
      JSON.stringify({
        difficulty,
        reps: result.summary.reps,
        max: result.summary.maximumProgressPercent,
        frames: result.summary.frames,
      }),
    );
  }
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls),
  ).toBe(0);
  expect(fs.readFileSync(`${root}/frozen-teacher.json`, "utf8")).toBe(frozen);
  if (final)
    fs.writeFileSync(
      `${root}/learner-request-audit.json`,
      JSON.stringify(
        {
          frozenSha256: freeze.sha256,
          hashUnchanged: true,
          cameraCalls: 0,
          movementRequests: requests,
        },
        null,
        2,
      ),
    );
});
