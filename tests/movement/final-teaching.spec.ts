import fs from "node:fs";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import { submitReview } from "./teaching-support";

const root = process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/final-mvp";

for (const [file, kind] of [
  ["data/lesson-squat.mp4", "cycle"],
  ["data/lesson-dance.mp4", "sequence"],
] as const) {
  test(`final fresh upload Teach persists and reloads ${kind}`, async ({ page }) => {
    test.skip(process.env.MOVEMENT_FINAL_VALIDATION !== "1", "Explicit final fixture validation");
    fs.mkdirSync(root, { recursive: true });
    const name = `FINAL MVP ${kind} ${Date.now()}`;
    await page.addInitScript(() => {
      (window as unknown as { finalCameraCalls: number }).finalCameraCalls = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        (window as unknown as { finalCameraCalls: number }).finalCameraCalls++;
        throw new Error("Final uploads must not request camera");
      };
    });
    const movementRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/movement")) movementRequests.push(request.url());
    });
    await page.goto("/");
    await page.getByLabel("Apprentice").selectOption("mock");
    await page.getByTestId("source-upload").click();
    await page.getByTestId("upload-video-input").setInputFiles(file);
    await page.getByTestId("upload-video-submit").click();
    await page.getByPlaceholder(/Controlled movement/).fill(name);
    await page
      .getByRole("radio", { name: kind === "cycle" ? "Repeating" : "One sequence", exact: true })
      .check();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    const started = Date.now();
    await page.getByRole("button", { name: "Analyze this video" }).click();
    await expect(page.getByTestId("analysis-stage")).toBeVisible();
    await submitReview(page);
    const saved = await page.evaluate(async (name) => {
      const dbPath = "/src/frontend/storage/IndexedDb.ts",
        debugPath = "/src/frontend/debug/DebugBus.ts";
      const { getDb } = (await import(
        dbPath
      )) as typeof import("../../src/frontend/storage/IndexedDb");
      const { DebugBus } = (await import(
        debugPath
      )) as typeof import("../../src/frontend/debug/DebugBus");
      const lesson = ((await (await getDb()).getAll("lessons")) as Lesson[]).find(
        (l) => l.name === name,
      );
      if (!lesson) throw new Error("Saved lesson not found");
      return { lesson, events: DebugBus.getEvents() };
    }, name);
    const lesson = saved.lesson as Lesson;
    const original = JSON.stringify(lesson);
    await page.reload();
    const loaded = await page.evaluate(async (id) => {
      const repositoryPath = "/src/frontend/storage/LessonRepository.ts",
        schemaPath = "/src/frontend/lesson/LessonSchema.ts";
      const { LessonRepository } = (await import(
        repositoryPath
      )) as typeof import("../../src/frontend/storage/LessonRepository");
      const { LessonSchema } = (await import(
        schemaPath
      )) as typeof import("../../src/frontend/lesson/LessonSchema");
      const local = await LessonRepository.get(id);
      const response = await fetch(`/api/lessons/${id}`);
      if (!response.ok) throw new Error(`Remote persistence failed ${response.status}`);
      const remote = await response.json();
      return {
        local,
        remote,
        schemaValid:
          LessonSchema.safeParse(local).success && LessonSchema.safeParse(remote).success,
      };
    }, lesson.id);
    expect(JSON.stringify(loaded.local)).toBe(original);
    expect(loaded.schemaValid).toBe(true);
    expect(loaded.remote.canonicalMovement).toEqual(lesson.canonicalMovement);
    expect(lesson.canonicalMovement.representation).toBe("mediapipe-articulated-3d-v1");
    expect(lesson.canonicalMovement.kind).toBe(kind);
    expect(lesson.canonicalMovement.statisticalCalibration).toBeUndefined();
    const references = lesson.canonicalMovement.references!.filter((r) => r.alignmentEligible);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.samples.length).toBeLessThanOrEqual(20);
      expect(reference.teacherConfirmed).toBe(true);
      expect(reference.anchors.map((a) => a.id)).toEqual(["start", "completion"]);
      expect(reference.anchors.every((a) => a.holdMs === 0)).toBe(true);
      expect(
        reference.samples.every(
          (s) =>
            s.phase === "sequence" &&
            s.pose.articulated3d &&
            !s.pose.body3d &&
            !s.pose.bodySkeleton,
        ),
      ).toBe(true);
      for (const sample of reference.samples)
        expect(
          reference.sourceTrajectory.some(
            (p) =>
              p.timestampMs === sample.pose.timestampMs &&
              JSON.stringify(p.articulated3d) === JSON.stringify(sample.pose.articulated3d),
          ),
        ).toBe(true);
    }
    expect(lesson.demonstrations.every((d) => d.apexMs === undefined)).toBe(true);
    expect(movementRequests).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { finalCameraCalls: number }).finalCameraCalls,
      ),
    ).toBe(0);
    const result = {
      lesson: loaded.local,
      extractionStats: saved.events.filter((e) => e.event === "POSE_EXTRACT_COMPLETE").at(-1)?.data,
      analysisStats: saved.events.filter((e) => e.event === "ANALYZE_COMPLETE").at(-1)?.data,
      wallMs: Date.now() - started,
      persistence: { localExact: true, remoteCanonicalExact: true, schemaValid: true },
      cameraCalls: 0,
      movementRequests,
      simulated:
        "Expert review answers and confirmation supplied by harness; real uploaded media and current production Teach/save/reload path.",
    };
    fs.writeFileSync(`${root}/teacher-${kind}.json`, JSON.stringify(result));
    console.log(
      JSON.stringify({
        kind,
        references: references.length,
        observations: result.extractionStats,
        persistedId: lesson.id,
      }),
    );
  });
}
