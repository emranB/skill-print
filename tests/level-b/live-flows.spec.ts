/**
 * AUTOMATED CHROMIUM FAKE-MEDIA PASS. The camera is a recorded video replayed by Chromium
 * and every typed answer is a SIMULATED TEST RESPONSE. This is not a real camera test.
 */
import fs from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  SOURCE_VIDEO,
  countEvents,
  debugEvents,
  expectDevicesReleased,
  fakeCameraLaunchArgs,
  installTrackProbe,
  liveTracks,
  passTeachCalibration,
  chooseCapture,
} from "./support";

test.use({ launchOptions: { args: fakeCameraLaunchArgs() } });
test.describe.configure({ mode: "serial" });

const LESSON_NAME = `Upload Lesson ${Date.now()}`;
let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ permissions: ["camera", "microphone"], acceptDownloads: true });
  page = await context.newPage();
  await installTrackProbe(page);
  await page.goto("/");
});

test.afterEach(async ({ browserName: _browser }, info) => {
  if (info.status === info.expectedStatus) return;
  const events = await debugEvents(page);
  console.log(`DEBUG_TAIL ${events.slice(-40).map((e) => `${e.event}${e.data ? ` ${JSON.stringify(e.data)}` : ""}`).join("\n")}`);
});

test.afterAll(async () => {
  await context.close();
});

async function selectInput(source: "live" | "upload" | "fixture") {
  await chooseCapture(page, source);
}

test("live Teach calibrates from detected poses, records poses and offers the video download", async () => {
  test.setTimeout(240_000);
  await selectInput("live");
  await page.getByRole("button", { name: /Teach a Skill/i }).click();

  const fullBody = page.getByTestId("check-full-body");
  await expect(page.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
  await expect(fullBody).toHaveAttribute("data-health", "valid", { timeout: 90_000 });
  await expect(page.getByTestId("check-body-scale")).toHaveAttribute("data-health", "valid");
  const calibrationEvents = await debugEvents(page);
  expect(countEvents(calibrationEvents, "CALIBRATION_POSE_RECEIVED")).toBe(1);
  expect(countEvents(calibrationEvents, "CALIBRATION_VALID")).toBeGreaterThanOrEqual(2);
  await passTeachCalibration(page);

  await page.getByPlaceholder(/Controlled movement/i).fill("Live Check");
  await page.getByRole("button", { name: /^Continue$/i }).click();
  await page.getByRole("button", { name: /^Start recording$/i }).click();
  await page.getByRole("button", { name: /^Start recording$/i }).click();

  const status = page.getByTestId("live-pose-status");
  await expect(status).toContainText("running", { timeout: 60_000 });
  await expect(status).toHaveText(/([4-9]\d|\d{3,}) frames recorded/, { timeout: 30_000 });
  console.log(`LIVE_TEACH ${(await status.textContent()) ?? ""}`);
  await page.getByRole("button", { name: /^Stop/i }).click();

  const download = page.getByTestId("download-recording");
  await expect(download).toBeVisible({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  const saved = await file.path();
  expect(fs.statSync(saved).size).toBeGreaterThan(10_000);
  console.log(`LIVE_TEACH_DOWNLOAD ${file.suggestedFilename()} ${fs.statSync(saved).size} bytes`);

  const recorded = (await debugEvents(page)).find((e) => e.event === "LIVE_RECORDING_STOPPED");
  console.log(`LIVE_TEACH_STOP ${JSON.stringify(recorded?.data ?? null)}`);
});

test("Teach to Home releases the camera, microphone and pose loop", async () => {
  expect((await liveTracks(page)).total).toBeGreaterThan(0);
  await page.getByTestId("exit-home").click();
  await expect(page.getByRole("button", { name: /Teach a Skill/i })).toBeVisible();
  await expectDevicesReleased(page);
});

test("upload Teach runs real extraction, transcription and semantics into a saved Work Map", async () => {
  test.setTimeout(600_000);
  await page.getByLabel("Apprentice").selectOption("elevenlabs");
  await selectInput("upload");
  await page.getByTestId("upload-video-input").setInputFiles(SOURCE_VIDEO);
  await page.getByTestId("upload-video-submit").click();
  await page.getByPlaceholder(/Controlled movement/i).fill(LESSON_NAME);
  await page.getByRole("button", { name: /^Continue$/i }).click();

  const started = Date.now();
  await page.getByRole("button", { name: "Analyze this video" }).click();
  await expect(page.getByTestId("download-recording")).toHaveAttribute("download", "lesson-squat.mp4");
  await expect(page.getByTestId("analysis-stage")).toBeVisible();
  const captureAnswer = page.getByPlaceholder("Explain what mattered in this moment");
  await expect(captureAnswer.or(page.locator(".debrief"))).toBeVisible({ timeout: 480_000 });
  console.log(`UPLOAD_ANALYSIS_MS ${Date.now() - started}`);

  let capture = 0;
  while (await captureAnswer.isVisible().catch(() => false)) {
    capture += 1;
    await captureAnswer.fill(`SIMULATED TEST RESPONSE: capture answer ${capture}, keep the movement controlled.`);
    await page.getByRole("button", { name: /Next question|Continue to debrief/ }).click();
  }
  let debrief = 0;
  const teachBack = page.getByRole("heading", { name: "Teach-back" });
  await expect(page.locator(".debrief").first()).toBeVisible({ timeout: 120_000 });
  while (!(await teachBack.isVisible())) {
    const box = page.locator(".debrief textarea");
    if (await box.isVisible().catch(() => false)) {
      debrief += 1;
      await box.fill(`SIMULATED TEST RESPONSE: debrief answer ${debrief}, avoid rushing the return.`);
      await page.getByRole("button", { name: /^(Next|Teach-back)$/ }).click();
    } else if (await page.getByRole("button", { name: /Continue to teach-back/ }).isVisible()) {
      await page.getByRole("button", { name: /Continue to teach-back/ }).click();
    } else {
      await page.waitForTimeout(500);
    }
  }
  console.log(`UPLOAD_QUESTIONS capture=${capture} debrief=${debrief}`);

  const items = page.locator(".teach-back-items > li");
  await expect(items.first()).toBeVisible({ timeout: 120_000 });
  const itemCount = await items.count();
  expect(itemCount).toBeGreaterThanOrEqual(3);
  await items.nth(0).getByRole("button", { name: "Correct" }).click();
  await items.nth(0).locator("textarea").fill("SIMULATED TEST RESPONSE: corrected teach-back point");
  await items.nth(0).getByRole("button", { name: "Save correction" }).click();
  await items.nth(1).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Keep all remaining" }).click();
  await page.getByRole("button", { name: /Confirm teach-back/ }).click();

  const map = page.locator(".lesson-map");
  await expect(map).toBeVisible();
  await expect(map.locator(".checkpoint-list > li")).toHaveCount(9);
  await expect(map).toContainText("SIMULATED TEST RESPONSE: corrected teach-back point");
  await expect(map.locator("blockquote").first()).toBeVisible();
  await expect(map).not.toContainText(/placeholder|lorem|TODO|undefined|NaN/i);
  const knowledgeHeading = (await map.getByRole("heading", { name: /Expert knowledge/ }).textContent()) ?? "";
  const guardrailHeading = (await map.getByRole("heading", { name: /Guardrails/ }).textContent()) ?? "";
  console.log(`WORK_MAP ${knowledgeHeading} | ${guardrailHeading} | teach-back items ${itemCount}`);

  const replayButtons = map.getByRole("button", { name: /Replay evidence/ });
  const labels = await replayButtons.allTextContents();
  const target = labels.findIndex((l) => Number(/([\d.]+)s to/.exec(l)?.[1] ?? 0) > 1);
  expect(target).toBeGreaterThanOrEqual(0);
  const [, startText, endText] = /([\d.]+)s to ([\d.]+)s/.exec(labels[target]!) ?? [];
  await replayButtons.nth(target).click();
  const clip = page.locator(".lesson-review video.moment-clip");
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(Number(startText) - 0.25);
  const playhead = await clip.evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(playhead).toBeLessThanOrEqual(Number(endText) + 0.5);
  console.log(`REPLAY ${labels[target]} playhead=${playhead.toFixed(2)}s`);

  await page.getByRole("button", { name: "Submit lesson" }).click();
  await expect(page.getByRole("heading", { name: "Lesson saved" })).toBeVisible({ timeout: 15_000 });
});

test("the saved lesson survives a reload with its full contract intact", async () => {
  await page.reload();
  const stored = await page.evaluate(
    (name) =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const open = indexedDB.open("skillprint", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("lessons").objectStore("lessons").getAll();
          req.onsuccess = () => {
            const found = (req.result as Array<Record<string, unknown>>).find((l) => l.name === name) ?? null;
            open.result.close();
            resolve(found);
          };
        };
      }),
    LESSON_NAME,
  );
  expect(stored).not.toBeNull();
  const lesson = stored as {
    schemaVersion: number;
    canonicalMovement: { checkpoints: unknown[] };
    knowledge: Array<{ provenance: { sourceClass: string; transcriptText?: string; expertAnswer?: string } }>;
    guardrails: unknown[];
    trackingProfile: { requiredLandmarks: number[] };
  };
  expect(lesson.schemaVersion).toBe(1);
  expect(lesson.canonicalMovement.checkpoints).toHaveLength(9);
  expect(lesson.knowledge.some((k) => k.provenance.sourceClass === "EXPLICIT_TEACHING" && k.provenance.transcriptText)).toBe(true);
  expect(lesson.knowledge.some((k) => k.provenance.sourceClass === "CONFIRMED_TEACH_BACK")).toBe(true);
  expect(lesson.trackingProfile.requiredLandmarks.length).toBeGreaterThan(0);
  console.log(
    `LESSON_STORED knowledge=${lesson.knowledge.length} guardrails=${lesson.guardrails.length} ` +
      `answers=${lesson.knowledge.filter((k) => k.provenance.expertAnswer).length}`,
  );
});

test("live Learn tracks the fake camera against the saved lesson with ghost and progress", async () => {
  test.setTimeout(300_000);
  await page.getByLabel("Apprentice").selectOption("elevenlabs");
  await selectInput("live");
  await page.getByRole("button", { name: /Learn a Skill/i }).click();
  await page.getByRole("button", { name: LESSON_NAME }).click();

  await expect(page.getByTestId("check-full-body")).toHaveAttribute("data-health", "valid", { timeout: 90_000 });
  await page.getByRole("button", { name: /^Continue$/i }).click();
  const prediction = page.getByTestId("prediction-question");
  await expect(prediction).not.toHaveText(/preparing/i, { timeout: 60_000 });
  console.log(`LEARN_PREDICTION ${(await prediction.textContent()) ?? ""}`);
  await page.locator(".learn-start textarea").fill("SIMULATED TEST RESPONSE: I expect to control the descent.");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await expect(page.getByTestId("live-stage")).toHaveAttribute("data-tracking", "true", { timeout: 60_000 });
  await page.getByRole("button", { name: "Begin attempt" }).click();

  await expect(page.getByTestId("live-pose-status")).toContainText("running", { timeout: 60_000 });
  await expect(page.getByTestId("live-stage")).toHaveAttribute("data-tracking", "true", { timeout: 30_000 });
  const progress = page.getByTestId("learn-progress");
  await expect.poll(async () => Number(await progress.getAttribute("data-frames")), { timeout: 30_000 }).toBeGreaterThan(30);

  const matches = new Set<string>();
  const indices = new Set<string>();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const text = (await progress.textContent()) ?? "";
    matches.add(/match (\d+)%/.exec(text)?.[1] ?? "");
    indices.add(/Checkpoint (\d+)/.exec(text)?.[1] ?? "");
    if (/reps [1-9]/.test(text)) break;
    await page.waitForTimeout(250);
  }
  const final = (await progress.textContent()) ?? "";
  const events = await debugEvents(page);
  console.log(
    `LEARN_LIVE final="${final}" frames=${await progress.getAttribute("data-frames")} ` +
      `matchValues=${[...matches].sort((x, y) => Number(x) - Number(y)).join(",")} checkpointsSeen=${[...indices].join(",")} ` +
      `passed=${countEvents(events, "CHECKPOINT_PASSED")} reps=${countEvents(events, "REP_SUCCESS")} ` +
      `coaching=${countEvents(events, "COACHING_CUE")}`,
  );
  expect([...matches].filter((m) => Number(m) > 0).length).toBeGreaterThan(3);

  await page.getByRole("button", { name: "Finish lesson" }).click();
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible();
  await expectDevicesReleased(page);
  console.log(`MASTERY ${(await page.locator(".mastery-stats").textContent()) ?? ""}`);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /Teach a Skill/i })).toBeVisible();
});

test("Teach after Learn starts from a clean calibration and lesson setup", async () => {
  await page.getByRole("button", { name: /Teach a Skill/i }).click();
  await expect(page.getByTestId("check-full-body")).toHaveAttribute("data-health", "lost");
  await expect(page.getByPlaceholder(/blue river seven/i)).toHaveValue("");
  await expect(page.getByTestId("check-full-body")).toHaveAttribute("data-health", "valid", { timeout: 90_000 });
  await passTeachCalibration(page);
  await expect(page.getByPlaceholder(/Controlled movement/i)).toHaveValue("");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: /Teach a Skill/i })).toBeVisible();
  await expectDevicesReleased(page);
  const events = await debugEvents(page);
  expect(countEvents(events, "APPLICATION_STARTED")).toBe(1);
  const transitions = events.filter((e) => e.event === "STATE_TRANSITION").map((e) => JSON.stringify(e.data));
  expect(transitions.filter((t, i) => i > 0 && t === transitions[i - 1])).toEqual([]);
  console.log(`LIFECYCLE transitions=${transitions.length} cameraAcquired=${countEvents(events, "CAMERA_ACQUIRED")} cameraReleased=${countEvents(events, "CAMERA_RELEASED")} poseStarted=${countEvents(events, "LIVE_POSE_STARTED")} poseStopped=${countEvents(events, "LIVE_POSE_STOPPED")}`);
});
