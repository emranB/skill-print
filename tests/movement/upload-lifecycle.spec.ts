import fs from "node:fs";
import { expect, test } from "@playwright/test";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";

test("uploaded learner completes at EOF without opening a camera or clicking Finish", async ({
  page,
}) => {
  test.setTimeout(120000);
  const final = process.env.MOVEMENT_FINAL_VALIDATION === "1";
  const root = final
    ? (process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/final-mvp")
    : process.env.MOVEMENT_VALIDATION_ROOT
      ? `${process.env.MOVEMENT_VALIDATION_ROOT}/regression`
      : "test-results/movement";
  const source = final
    ? `${root}/teacher-cycle.json`
    : `${root}/articulated-v1/product-teacher-cycle.json`;
  const { lesson } = JSON.parse(
    fs.readFileSync(
      fs.existsSync(source) ? source : "test-results/movement/articulated-v1/teacher-cycle.json",
      "utf8",
    ),
  ) as { lesson: Lesson };
  if (!final) {
    lesson.id = "upload-lifecycle-validation";
    lesson.name = "Upload lifecycle validation";
  }
  await page.addInitScript(() => {
    const timing = { eofAt: 0, resultAt: 0 };
    (window as unknown as { resultTiming: typeof timing }).resultTiming = timing;
    document.addEventListener(
      "ended",
      (event) => {
        if (event.target instanceof HTMLVideoElement && event.target.closest(".learner-video-host"))
          timing.eofAt = performance.now();
      },
      true,
    );
    const observer = new MutationObserver(() => {
      if (timing.eofAt && document.querySelector(".mastery-report")) {
        timing.resultAt = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    (window as unknown as { cameraCalls: number }).cameraCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as unknown as { cameraCalls: number }).cameraCalls++;
      throw new Error("Uploaded learner must not request camera");
    };
  });
  const movementRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/movement")) movementRequests.push(r.url());
  });
  await page.goto("/");
  if (!final)
    await page.evaluate(async (lesson) => {
      const path = "/src/frontend/storage/IndexedDb.ts";
      const { getDb } = (await import(
        path
      )) as typeof import("../../src/frontend/storage/IndexedDb");
      await (await getDb()).put("lessons", lesson);
    }, lesson);
  await page.reload();
  await page.getByTestId("source-upload").click();
  await page.getByTestId("upload-video-input").setInputFiles("videos/test-squat-student_1.mp4");
  await page.getByRole("button", { name: /Learn a Skill/i }).click();
  await page.getByRole("button", { name: lesson.name }).click({ timeout: 15000 });
  await expect(page.locator(".learn-start textarea")).toBeVisible({ timeout: 60000 });
  await page.locator(".learn-start textarea").fill("SIMULATED TEST RESPONSE: movement prediction");
  await page.getByRole("button", { name: "Start lesson", exact: true }).click();
  await page.getByRole("button", { name: "Begin attempt", exact: true }).click();
  await expect(page.getByTestId("movement-quality")).toBeVisible();
  await expect
    .poll(
      async () => Number(await page.getByTestId("learn-progress").getAttribute("data-frames")),
      { timeout: 20000 },
    )
    .toBeGreaterThan(60);
  const canvasEvidence = await page.locator(".skeleton-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0,
      teacher = 0,
      learner = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3]! > 0) {
        visible++;
        if (pixels[i]! > 150 && pixels[i + 1]! > 90 && pixels[i + 2]! < 140) teacher++;
        if (pixels[i]! < 130 && pixels[i + 1]! > 100 && pixels[i + 2]! > 60) learner++;
      }
    return { visible, teacher, learner };
  });
  const canvasPixels = canvasEvidence.visible;
  expect(canvasPixels).toBeGreaterThan(100);
  expect(canvasEvidence.teacher).toBeGreaterThan(30);
  expect(canvasEvidence.learner).toBeGreaterThan(100);
  const canvasWidth = await page
    .locator(".skeleton-canvas")
    .evaluate((element) => (element as HTMLCanvasElement).width);
  expect(canvasWidth).toBeLessThanOrEqual(960);
  await expect(page.getByTestId("live-pose-status")).toContainText("running");
  await expect(page.getByTestId("learn-progress")).toContainText("Cycle");
  await page.screenshot({ path: `${root}/upload-active.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(
      async () => Number(await page.getByTestId("learn-progress").getAttribute("data-frames")),
      { timeout: 10000 },
    )
    .toBeGreaterThan(85);
  await page.screenshot({ path: `${root}/upload-mobile.png` });
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible({
    timeout: 65000,
  });
  const events = await page.evaluate(async () => {
    const path = "/src/frontend/debug/DebugBus.ts";
    const { DebugBus } = (await import(path)) as typeof import("../../src/frontend/debug/DebugBus");
    return DebugBus.getEvents();
  });
  const evaluations = events.filter((e) => e.event === "LEARN_EVALUATION_COMPLETE");
  expect(evaluations).toHaveLength(1);
  const runId = (evaluations[0]!.data as { runId: string }).runId;
  for (const name of [
    "LEARNER_VIDEO_CALIBRATION_STARTED",
    "LEARNER_VIDEO_CALIBRATED",
    "LEARN_RUN_STARTED",
  ]) {
    expect(
      events.filter((e) => e.event === name && (e.data as { runId?: string })?.runId === runId),
    ).toHaveLength(1);
  }
  expect((evaluations[0]!.data as { termination: string }).termination).toBe("eof");
  const calibrated = events.find((e) => e.event === "LEARNER_VIDEO_CALIBRATED")!.data as {
    windowStartMs: number;
    rewoundToMs: number;
  };
  expect(calibrated.windowStartMs).toBeGreaterThanOrEqual(0);
  expect(calibrated.rewoundToMs).toBe(0);
  const summary = evaluations[0]!.data as { reps: number };
  expect(
    events.filter(
      (e) => e.event === "REP_SUCCESS" && (e.data as { runId?: string })?.runId === runId,
    ),
  ).toHaveLength(summary.reps);
  expect(events.some((e) => e.event === "COACHING_CUE")).toBe(true);
  expect(movementRequests).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls),
  ).toBe(0);
  const media = await page
    .locator("video")
    .evaluateAll((videos) =>
      videos.map((v) => ({ paused: (v as HTMLVideoElement).paused, src: v.getAttribute("src") })),
    );
  expect(media.every((v) => v.paused)).toBe(true);
  const resultTiming = await page.evaluate(
    () => (window as unknown as { resultTiming: { eofAt: number; resultAt: number } }).resultTiming,
  );
  expect(resultTiming.resultAt).toBeGreaterThan(resultTiming.eofAt);
  await page.screenshot({ path: `${root}/upload-results.png` });
  fs.writeFileSync(
    `${root}/upload-lifecycle.json`,
    JSON.stringify(
      {
        evaluations,
        events: events.filter((e) => /LEARN|REP_SUCCESS|SEQUENCE_COMPLETE|COACHING/.test(e.event)),
        media,
        cameraCalls: 0,
        canvasPixels,
        canvasEvidence,
        movementRequests,
        lessonId: lesson.id,
        representation: lesson.canonicalMovement.representation,
        eofToResultMs: resultTiming.resultAt - resultTiming.eofAt,
      },
      null,
      2,
    ),
  );
});
