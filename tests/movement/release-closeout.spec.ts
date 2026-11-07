import fs from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { expect, test, type Page } from "@playwright/test";
import {
  fakeCameraLaunchArgs,
  installTrackProbe,
  passTeachCalibration,
  expectDevicesReleased,
} from "../level-b/support";
import { submitReview } from "./teaching-support";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import { LessonSchema } from "../../src/frontend/lesson/LessonSchema";

const root = process.env.MOVEMENT_VALIDATION_ROOT ?? "test-results/movement/release-mvp";
test.use({
  launchOptions: { args: fakeCameraLaunchArgs() },
  permissions: ["camera", "microphone"],
});
test.beforeEach(({ page }) => {
  page.setDefaultTimeout(15000);
  test.skip(
    process.env.MOVEMENT_RELEASE_CLOSEOUT !== "1",
    "Explicit MVP closeout workflow validation",
  );
  fs.mkdirSync(root, { recursive: true });
});

for (const [representation, tracker] of [
  ["legacy-2d", "ProgressTracker"],
  ["rtmw3d-body-v1", "LocalProgressTracker"],
  ["mediapipe-heavy-body3d-v1", "HeavyProgressTracker"],
] as const) {
  test(`persisted ${representation} routes explicitly without geometry migration`, async ({
    page,
  }) => {
    const lessons = fs
      .readdirSync("lessons")
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(fs.readFileSync(`lessons/${n}`, "utf8")));
    const lesson = lessons.find(
      (l) =>
        (representation === "legacy-2d"
          ? l.canonicalMovement.schemaVersion !== 3
          : l.canonicalMovement.representation === representation) &&
        LessonSchema.safeParse(l).success,
    ) as Lesson | undefined;
    test.skip(!lesson, "No persisted compatibility fixture exists");
    await page.goto("/");
    const result = await page.evaluate(async (lesson) => {
      const runPath = "/src/frontend/learn/LearningRun.ts",
        configPath = "/src/frontend/config/RuntimeConfig.ts";
      const { LearningRun } = (await import(
        runPath
      )) as typeof import("../../src/frontend/learn/LearningRun");
      const { RuntimeConfigManager } = (await import(
        configPath
      )) as typeof import("../../src/frontend/config/RuntimeConfig");
      const before = JSON.stringify(lesson);
      const run = new LearningRun(lesson, RuntimeConfigManager.get(), "upload");
      const tracker = run.tracker.constructor.name;
      run.finish("cancelled");
      return { tracker, unchanged: JSON.stringify(lesson) === before };
    }, lesson!);
    expect(result.tracker).toBe(tracker);
    expect(result.unchanged).toBe(true);
    fs.writeFileSync(
      `${root}/compatibility-${representation}.json`,
      JSON.stringify({ id: lesson!.id, ...result }),
    );
  });
}

async function uploadTeach(page: Page, name: string, file: string) {
  await page.goto("/");
  await page.getByLabel("Apprentice").selectOption("mock");
  await page.getByTestId("source-upload").click();
  await page.getByTestId("upload-video-input").setInputFiles(file);
  await page.getByTestId("upload-video-submit").click();
  await page.getByPlaceholder(/Controlled movement/).fill(name);
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.getByRole("button", { name: "Analyze this video" }).click();
}

test("catalog refresh loads newer remote geometry on selection without migrating its representation", async ({
  page,
}) => {
  const { lesson } = JSON.parse(fs.readFileSync(`${root}/teacher-cycle.json`, "utf8")) as {
    lesson: Lesson;
  };
  const old = {
    ...lesson,
    id: "catalog-refresh",
    name: "Catalog old",
    updatedAt: "2025-01-01T00:00:00Z",
  };
  const remote = { ...old, name: "Catalog updated", updatedAt: "2026-01-01T00:00:00Z" };
  await page.route("**/api/lessons?summary=1", (route) =>
    route.fulfill({
      json: { lessons: [{ id: remote.id, name: remote.name, updatedAt: remote.updatedAt }] },
    }),
  );
  await page.route("**/api/lessons/catalog-refresh", (route) => route.fulfill({ json: remote }));
  await page.goto("/");
  const result = await page.evaluate(async (old) => {
    const dbPath = "/src/frontend/storage/IndexedDb.ts",
      repoPath = "/src/frontend/storage/LessonRepository.ts";
    const { getDb } = (await import(
      dbPath
    )) as typeof import("../../src/frontend/storage/IndexedDb");
    const { LessonRepository } = (await import(
      repoPath
    )) as typeof import("../../src/frontend/storage/LessonRepository");
    await (await getDb()).put("lessons", old);
    const summaries = await LessonRepository.listSummaries();
    const loaded = await LessonRepository.get(old.id);
    return { summary: summaries.find((s) => s.id === old.id), loaded };
  }, old);
  expect(result.summary?.name).toBe(remote.name);
  expect(result.loaded).toEqual(remote);
  expect(result.loaded!.canonicalMovement).toEqual(old.canonicalMovement);
});

test("lesson library fetches a compact catalog instead of every pose history", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/lessons") requests.push(r.url());
  });
  const response = await page.request.get("/api/lessons?summary=1");
  expect(response.ok()).toBe(true);
  const body = await response.text();
  expect(body).not.toContain("canonicalMovement");
  expect(body).not.toContain("sourceTrajectory");
  const catalog = JSON.parse(body) as {
    lessons: Array<{ id: string; name: string; updatedAt: string }>;
  };
  expect(catalog.lessons.length).toBeGreaterThan(0);
  expect(body.length / catalog.lessons.length).toBeLessThan(1000);
  await page.goto("/");
  await page.getByRole("button", { name: /Learn a Skill/ }).click();
  await expect(page.getByRole("button", { name: catalog.lessons[0]!.name })).toBeVisible();
  expect(requests.every((url) => new URL(url).searchParams.get("summary") === "1")).toBe(true);
  fs.writeFileSync(
    `${root}/catalog.json`,
    JSON.stringify({ bytes: body.length, lessons: catalog.lessons.length, requests }),
  );
});

test.describe("live Teach through save", () => {
  test("one live capture compiles and saves one coherent reference without segmentation", async ({
    page,
  }) => {
    // A controlled video-backed camera records one execution, not the looping multi-execution feed.
    const clip = `${root}/live-execution.mp4`;
    const cut = spawnSync(
      ffmpegPath as unknown as string,
      [
        "-y",
        "-ss",
        "12.867",
        "-t",
        "2.8",
        "-i",
        "data/lesson-squat.mp4",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        clip,
      ],
      { encoding: "utf8" },
    );
    expect(cut.status, cut.stderr).toBe(0);
    await page.addInitScript((clipUrl) => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let acquisition = 0;
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints?.video) return original(constraints);
        const request = ++acquisition;
        const feed = document.createElement("video");
        feed.muted = true;
        feed.src = clipUrl;
        feed.style.display = "none";
        document.body.append(feed);
        await new Promise<void>((resolve) =>
          feed.addEventListener("loadeddata", () => resolve(), { once: true }),
        );
        await feed.play();
        feed.pause();
        const capture = (
          feed as HTMLVideoElement & { captureStream(): MediaStream }
        ).captureStream();
        if (constraints.audio) {
          const audio = await original({ audio: constraints.audio });
          audio.getAudioTracks().forEach((track) => capture.addTrack(track));
        }
        if (request === acquisition)
          (window as unknown as { cameraFeed: HTMLVideoElement }).cameraFeed = feed;
        capture.getVideoTracks().forEach((track) =>
          track.addEventListener(
            "ended",
            () => {
              feed.pause();
              feed.remove();
            },
            { once: true },
          ),
        );
        return capture;
      };
    }, `/${clip}`);
    await installTrackProbe(page);
    await page.goto("/");
    await page.evaluate(async () => {
      const path =
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === "/src/frontend/pose/PoseRecorder.ts") ??
        "/src/frontend/pose/PoseRecorder.ts";
      const { PoseRecorder } = (await import(
        path
      )) as typeof import("../../src/frontend/pose/PoseRecorder");
      const original = PoseRecorder.prototype.toRecording;
      PoseRecorder.prototype.toRecording = function () {
        const recording = original.call(this);
        (window as unknown as { liveRecording: typeof recording }).liveRecording = recording;
        return recording;
      };
    });
    await page.getByLabel("Apprentice").selectOption("mock");
    await page.getByTestId("source-camera").click();
    await page.getByRole("button", { name: /Teach a Skill/ }).click();
    await passTeachCalibration(page);
    const name = `Release live execution ${Date.now()}`;
    await page.getByPlaceholder(/Controlled movement/).fill(name);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await page.getByRole("button", { name: /^Start recording$/ }).click();
    await expect(page.getByTestId("live-pose-status")).toContainText("running", { timeout: 60000 });
    await page.getByRole("button", { name: /^Start recording$/ }).click();
    await page.evaluate(async () => {
      const feed = (window as unknown as { cameraFeed: HTMLVideoElement }).cameraFeed;
      await feed.play();
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (feed.ended || feed.currentTime >= feed.duration - 0.01) {
            feed.pause();
            resolve();
          } else requestAnimationFrame(tick);
        };
        tick();
      });
    });
    await page.getByRole("button", { name: /^Stop/ }).click();
    await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeVisible({
      timeout: 30000,
    });
    const recording = await page.evaluate(
      () => (window as unknown as { liveRecording: unknown }).liveRecording,
    );
    expect(recording).toBeDefined();
    fs.writeFileSync(`${root}/live-teach-recording.json`, JSON.stringify(recording));
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await submitReview(page);
    const saved = await page.evaluate(async (name) => {
      const path = "/src/frontend/storage/IndexedDb.ts";
      const { getDb } = (await import(
        path
      )) as typeof import("../../src/frontend/storage/IndexedDb");
      return ((await (await getDb()).getAll("lessons")) as Lesson[]).find((l) => l.name === name)!;
    }, name);
    expect(saved.canonicalMovement.representation).toBe("mediapipe-articulated-3d-v1");
    expect(saved.canonicalMovement.references!.filter((r) => r.alignmentEligible)).toHaveLength(1);
    await expectDevicesReleased(page);
    fs.writeFileSync(`${root}/live-teach.json`, JSON.stringify(saved));
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: /Learn a Skill/ }).click();
    await page.getByRole("button", { name }).click();
    await page.getByRole("button", { name: /^Continue$/ }).click({ timeout: 60000 });
    await expect(page.locator(".learn-start textarea")).toBeVisible({ timeout: 60000 });
    await page
      .locator(".learn-start textarea")
      .fill("SIMULATED CAMERA SELF-REPLAY: movement prediction");
    await page.getByRole("button", { name: "Start lesson", exact: true }).click();
    await expect(page.getByTestId("live-pose-status")).toContainText("running", { timeout: 60000 });
    await page.getByRole("button", { name: "Begin attempt", exact: true }).click();
    await page.evaluate(async () => {
      const feed = (window as unknown as { cameraFeed: HTMLVideoElement }).cameraFeed;
      await feed.play();
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (feed.ended || feed.currentTime >= feed.duration - 0.01) {
            feed.pause();
            resolve();
          } else requestAnimationFrame(tick);
        };
        tick();
      });
    });
    await expect(page.getByTestId("learn-progress")).toContainText(/reps [1-9]/, {
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Finish lesson", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible();
    await expectDevicesReleased(page);
    const events = await page.evaluate(async () => {
      const path = "/src/frontend/debug/DebugBus.ts";
      return (
        (await import(path)) as typeof import("../../src/frontend/debug/DebugBus")
      ).DebugBus.getEvents();
    });
    expect(events.filter((e) => e.event === "REP_SUCCESS")).toHaveLength(1);
    expect(events.filter((e) => e.event === "LEARN_EVALUATION_COMPLETE")).toHaveLength(1);
    fs.writeFileSync(
      `${root}/live-camera-self-replay.json`,
      JSON.stringify({ events, lessonId: saved.id }),
    );
  });
});

test("rejecting a reviewed upload proposal does not persist it as a reference", async ({
  page,
}) => {
  const name = `Release review subset ${Date.now()}`;
  await uploadTeach(page, name, "data/lesson-squat.mp4");
  await submitReview(page, true);
  const saved = await page.evaluate(async (name) => {
    const path = "/src/frontend/storage/IndexedDb.ts";
    const { getDb } = (await import(path)) as typeof import("../../src/frontend/storage/IndexedDb");
    return ((await (await getDb()).getAll("lessons")) as Lesson[]).find((l) => l.name === name)!;
  }, name);
  const ignored = saved.demonstrations.filter((d) => d.classification === "ignore");
  expect(ignored).toHaveLength(1);
  expect(
    saved.canonicalMovement.references!.some((r) => r.demonstrationId === ignored[0]!.id),
  ).toBe(false);
  expect(
    saved.canonicalMovement.references!.filter((r) => r.alignmentEligible).length,
  ).toBeGreaterThan(0);
  fs.writeFileSync(`${root}/review-subset.json`, JSON.stringify(saved));
});

for (const difficulty of [20, 50, 75, 80, 100]) {
  test(`saved dance self-replay at ${difficulty} reaches automatic sequence results through actual upload UI`, async ({
    page,
  }) => {
    const configuration = JSON.parse(fs.readFileSync("config.json", "utf8"));
    await page.route("**/api/config", (route) =>
      route.fulfill({
        json: { ...configuration, pose: { ...configuration.pose, matchDifficulty: difficulty } },
      }),
    );
    await page.addInitScript(() => {
      const timing = { eofAt: 0, resultAt: 0 };
      (window as unknown as { resultTiming: typeof timing }).resultTiming = timing;
      document.addEventListener(
        "ended",
        (event) => {
          if (
            event.target instanceof HTMLVideoElement &&
            event.target.closest(".learner-video-host")
          )
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
    });
    const { lesson } = JSON.parse(fs.readFileSync(`${root}/teacher-sequence.json`, "utf8")) as {
      lesson: Lesson;
    };
    let cameraCalls = 0;
    const movement: string[] = [],
      externalModel: string[] = [];
    await page.exposeFunction("unexpectedCamera", () => {
      cameraCalls++;
      throw Error("Upload camera");
    });
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        await (window as unknown as { unexpectedCamera: () => Promise<void> }).unexpectedCamera();
        throw Error("Upload camera");
      };
    });
    page.on("request", (r) => {
      if (r.url().includes("/api/movement")) movement.push(r.url());
      if (
        /https?:\/\//.test(r.url()) &&
        !r.url().startsWith("http://localhost:") &&
        /\.wasm|\.task|vision_wasm/.test(r.url())
      )
        externalModel.push(r.url());
    });
    await page.goto("/");
    await page.getByLabel("Apprentice").selectOption("mock");
    await page.getByTestId("source-upload").click();
    await page.getByTestId("upload-video-input").setInputFiles("data/lesson-dance.mp4");
    await page.evaluate(async () => {
      const path =
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === "/src/frontend/learn/LearningRun.ts") ??
        "/src/frontend/learn/LearningRun.ts";
      const { LearningRun } = (await import(
        path
      )) as typeof import("../../src/frontend/learn/LearningRun");
      const frames: import("../../src/frontend/pose/pose.types").PoseFrame[] = [];
      (window as unknown as { danceFrames: typeof frames }).danceFrames = frames;
      const original = LearningRun.prototype.processStudentFrame;
      LearningRun.prototype.processStudentFrame = function (frame) {
        frames.push(frame);
        return original.call(this, frame);
      };
    });
    await page.getByRole("button", { name: /Learn a Skill/ }).click();
    await page.getByRole("button", { name: lesson.name }).click();
    await expect(page.locator(".learn-start textarea")).toBeVisible({ timeout: 60000 });
    await page.locator(".learn-start textarea").fill("SIMULATED SELF-REPLAY: sequence prediction");
    await page.getByRole("button", { name: "Start lesson", exact: true }).click();
    await page.getByRole("button", { name: "Begin attempt" }).click();
    await expect(page.getByTestId("learn-progress")).toContainText("Sequence");
    await expect(page.getByTestId("movement-quality")).toBeVisible();
    if (difficulty === 75) {
      await expect
        .poll(async () =>
          Number(await page.getByTestId("learn-progress").getAttribute("data-frames")),
        )
        .toBeGreaterThan(30);
      await page.screenshot({ path: `${root}/dance-active.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${root}/dance-mobile.png` });
    }
    await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible({
      timeout: 60000,
    });
    const events = await page.evaluate(async () => {
      const path = "/src/frontend/debug/DebugBus.ts";
      return (
        (await import(path)) as typeof import("../../src/frontend/debug/DebugBus")
      ).DebugBus.getEvents();
    });
    const evaluation = events.filter((e) => e.event === "LEARN_EVALUATION_COMPLETE");
    const frames = await page.evaluate(
      () => (window as unknown as { danceFrames: unknown }).danceFrames,
    );
    expect((frames as unknown[]).length).toBe(
      Number((evaluation[0]!.data as { frames: number }).frames),
    );
    const resultTiming = await page.evaluate(
      () =>
        (window as unknown as { resultTiming: { eofAt: number; resultAt: number } }).resultTiming,
    );
    fs.writeFileSync(
      `${root}/dance-ui-${difficulty}.json`,
      JSON.stringify({
        evaluation,
        events,
        frames,
        movement,
        externalModel,
        cameraCalls,
        eofToResultMs: resultTiming.resultAt - resultTiming.eofAt,
      }),
    );
    expect(evaluation).toHaveLength(1);
    expect(evaluation[0]!.data).toMatchObject({
      sequenceComplete: true,
      reps: 0,
      termination: "eof",
    });
    expect(events.filter((e) => e.event === "SEQUENCE_COMPLETE")).toHaveLength(1);
    expect(events.filter((e) => e.event === "REP_SUCCESS")).toHaveLength(0);
    expect(evaluation[0]!.data).toMatchObject({
      maximumProgressPercent: 100,
      alignmentMethod: "ordered_targets",
    });
    await expect(page.locator(".mastery-stats")).toContainText("Match quality");
    await expect(page.locator(".mastery-stats")).not.toContainText("reps");
    expect(cameraCalls).toBe(0);
    expect(movement).toEqual([]);
    expect(externalModel).toEqual([]);
    expect(await page.locator("video").count()).toBe(0);
    expect(resultTiming.resultAt).toBeGreaterThan(resultTiming.eofAt);
    await page.screenshot({ path: `${root}/dance-results-${difficulty}.png` });
  });
}

test("failed pose-model analysis returns to review rather than leaving a working state", async ({
  page,
}) => {
  await page.route("**/models/pose_landmarker_heavy.task", (route) => route.abort());
  await uploadTeach(page, "Release failure recovery", "data/lesson-dance.mp4");
  await expect(page.locator(".recording-review .error-text")).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.locator(".teach-recording").getByRole("button", { name: "Use this video" }),
  ).toBeEnabled();
  await page.getByTestId("exit-home").click();
  await expect(page.getByRole("button", { name: /Teach a Skill/ })).toBeVisible();
});

test("current Heavy CPU and descriptor timing probe uses bundled local assets", async ({
  page,
}) => {
  const externalModel: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:") && /\.wasm|\.task|vision_wasm/.test(r.url()))
      externalModel.push(r.url());
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/frontend/pose/PoseDetector.ts";
    const { MediaPipePoseDetector } = (await import(
      path
    )) as typeof import("../../src/frontend/pose/PoseDetector");
    const detector = new MediaPipePoseDetector(15, { delegate: "CPU" });
    const video = document.createElement("video");
    video.muted = true;
    video.src = "/data/lesson-dance.mp4";
    await new Promise<void>((resolve) =>
      video.addEventListener("loadeddata", () => resolve(), { once: true }),
    );
    try {
      await detector.initialize();
      let descriptors = 0;
      for (let i = 0; i < 32; i++) {
        const seeked = new Promise<void>((resolve) =>
          video.addEventListener("seeked", () => resolve(), { once: true }),
        );
        video.currentTime = (i + 1) / 15;
        await seeked;
        if (detector.detectObserved(video, ((i + 1) * 1000) / 15)?.articulated3d) descriptors++;
      }
      const stats = (values: number[]) => ({
        mean: values.reduce((s, v) => s + v, 0) / values.length,
        p95: [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)],
      });
      return {
        samples: detector.inferenceMs.length,
        descriptors,
        inference: stats(detector.inferenceMs),
        descriptor: stats(detector.featureMs),
      };
    } finally {
      detector.dispose();
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  });
  expect(result.samples).toBe(32);
  expect(result.descriptors).toBeGreaterThan(0);
  expect(externalModel).toEqual([]);
  fs.writeFileSync(`${root}/cpu-probe.json`, JSON.stringify({ ...result, externalModel }, null, 2));
});
