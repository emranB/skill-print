import fs from "node:fs";
import { expect, test } from "@playwright/test";

test("Heavy articulated production extraction and CPU validation", async ({ page }) => {
  test.skip(
    process.env.MOVEMENT_HEAVY_PROBE !== "1",
    "Explicit teacher-only architecture validation",
  );
  const root = "test-results/movement/articulated-v1/model-probe";
  fs.mkdirSync(root, { recursive: true });
  await page.goto("/");
  for (const [url, kind] of [
    ["/data/lesson-squat.mp4", "cycle"],
    ["/data/lesson-dance.mp4", "sequence"],
  ] as const) {
    const result = await page.evaluate(
      async ({ url, kind }) => {
        const modulePath = "/src/scripts/level-b/runMovementValidation.ts",
          schemaPath = "/src/frontend/lesson/LessonSchema.ts";
        const mod = (await import(
          modulePath
        )) as typeof import("../../src/scripts/level-b/runMovementValidation");
        const schema = (await import(
          schemaPath
        )) as typeof import("../../src/frontend/lesson/LessonSchema");
        const result = await mod.compileTeacherFixture(url, kind);
        const validation = schema.LessonSchema.safeParse(result.lesson);
        return {
          ...result,
          validation: validation.success
            ? { success: true }
            : { success: false, issues: validation.error.issues },
        };
      },
      { url, kind },
    );
    fs.writeFileSync(`${root}/teacher-${kind}.json`, JSON.stringify(result));
    expect(result.lesson.canonicalMovement.representation).toBe("mediapipe-articulated-3d-v1");
    expect(result.validation.success, JSON.stringify(result.validation)).toBe(true);
    expect(result.analysis.poseRecording.frames.at(-1)!.timestampMs).toBeGreaterThan(
      kind === "cycle" ? 65000 : 9000,
    );
    console.log(
      JSON.stringify({
        kind,
        proposals: result.analysis.demonstrations.length,
        eligible: result.lesson.canonicalMovement.references!.filter((r) => r.alignmentEligible)
          .length,
      }),
    );
  }
  if (process.env.MOVEMENT_SKIP_CPU_PROBE === "1") return;
  const cpu = await page.evaluate(async () => {
    const modulePath = "/src/frontend/analyze/VideoPoseExtractor.ts";
    const mod = (await import(
      modulePath
    )) as typeof import("../../src/frontend/analyze/VideoPoseExtractor");
    const result = await mod.extractPoseRecordingFromVideoBlob(
      await (await fetch("/data/lesson-squat.mp4")).blob(),
      "cpu-validation",
      { delegate: "CPU" },
    );
    return {
      stats: result.stats,
      geometryFrames: result.poseRecording.frames.filter((f) => f.articulated3d).length,
    };
  });
  fs.writeFileSync(`${root}/heavy-cpu.json`, JSON.stringify(cpu, null, 2));
  expect(cpu.stats.delegate).toBe("CPU");
  expect(cpu.geometryFrames).toBeGreaterThan(900);
});
