import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, test, type Page } from "@playwright/test";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-gl=angle", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

/** Rejects getUserMedia for the given kinds before the app loads. */
async function denyMedia(page: Page, deny: { video?: boolean; audio?: boolean }) {
  await page.addInitScript((d) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
      if ((d.video && constraints?.video) || (d.audio && constraints?.audio)) {
        return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      }
      return original(constraints);
    };
  }, deny);
}

async function openLiveTeachCalibration(page: Page) {
  await page.goto("/");
  await page.getByTestId("source-camera").click();
  await page.getByRole("button", { name: /Teach a Skill/i }).click();
  await expect(page.getByText(/Teach calibration/i)).toBeVisible();
}

test("camera denied shows a clear error and blocks calibration", async ({ page }) => {
  await denyMedia(page, { video: true });
  await openLiveTeachCalibration(page);
  await expect(page.locator(".calibration-flow .error-text").first()).toContainText(/camera/i);
  await page.getByPlaceholder(/blue river seven/i).fill("blue river seven");
  await page.getByRole("button", { name: /Confirm phrase/i }).click();
  await expect(page.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
});

test("microphone denied offers video only and an empty camera never passes the body check", async ({ page }) => {
  test.setTimeout(120_000);
  await denyMedia(page, { audio: true });
  await openLiveTeachCalibration(page);
  await expect(page.getByTestId("microphone-unavailable")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/Continue video only/).check();
  await page.getByPlaceholder(/blue river seven/i).fill("blue river seven");
  await page.getByRole("button", { name: /Confirm phrase/i }).click();
  await expect(page.getByTestId("calibration-pose-status")).toContainText("running", { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId("check-full-body")).toHaveAttribute("data-health", "lost");
  await expect(page.getByRole("button", { name: /^Continue$/i })).toBeDisabled();
});

test("voice session failure never sticks on Connecting", async ({ page }) => {
  await page.route("**/api/elevenlabs/session", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Voice unavailable" }) }),
  );
  await page.goto("/");
  await page.getByLabel("Apprentice").selectOption("elevenlabs");
  await page.getByRole("button", { name: "Start Apprentice" }).click();
  await expect(page.locator(".voice-status .error-text")).toContainText("Voice unavailable");
  await expect(page.getByTestId("voice-status")).not.toHaveText(/Connecting/);
  await expect(page.getByRole("button", { name: "Start Apprentice" })).toBeVisible();
});

/** Upload Teach skips device calibration: pick the file, name the skill, analyze. */
async function startUploadTeach(page: Page, file: Parameters<Page["setInputFiles"]>[1], name: string) {
  await page.goto("/");
  await page.getByTestId("source-upload").click();
  await page.getByTestId("upload-video-input").setInputFiles(file);
  await page.getByTestId("upload-video-submit").click();
  await page.getByPlaceholder(/Controlled movement/i).fill(name);
  await page.getByRole("button", { name: /^Continue$/i }).click();
  await page.getByRole("button", { name: "Analyze this video" }).click();
}

test("invalid upload is rejected with a readable message", async ({ page }) => {
  await startUploadTeach(
    page,
    { name: "notes.mp4", mimeType: "video/mp4", buffer: Buffer.from("this is not a video") },
    "Bad Upload",
  );
  await expect(page.locator(".teach-recording .error-text")).toContainText("could not be read as a video");
});

/** Short local clip of the sample lesson so this test needs no network. */
function shortClip(): string {
  const out = path.resolve("test-results/e2e-short-clip.mp4");
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const run = spawnSync(
      ffmpegPath as unknown as string,
      ["-y", "-ss", "7", "-t", "5", "-i", path.resolve("data/lesson-squat.mp4"), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", out],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr?.slice(-400)}`);
  }
  return out;
}

test("transcription failure is reported and never replaced by invented narration", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "UPSTREAM_ERROR" }) }),
  );
  await startUploadTeach(page, shortClip(), "No Transcript");
  await expect(page.locator(".apprentice-panel .error-text")).toContainText("could not be transcribed", {
    timeout: 90_000,
  });
  await expect(page.locator(".debug-console")).toContainText("TRANSCRIBE_OPTIONAL_FAILED");
  await expect(page.locator(".debug-console")).not.toContainText("TRANSCRIBE_COMPLETE");
});

test("a damaged stored lesson is skipped and reported, not loaded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("skillprint", 1);
        open.onupgradeneeded = () => {
          const lessons = open.result.createObjectStore("lessons", { keyPath: "id" });
          lessons.createIndex("updatedAt", "updatedAt");
          open.result.createObjectStore("sessions", { keyPath: "id" });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("lessons", "readwrite");
          tx.objectStore("lessons").put({ id: "damaged", name: "Damaged Lesson", updatedAt: "2026-01-01" });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: /Learn a Skill/i }).click();
  await expect(page.getByRole("heading", { name: "Choose a lesson" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Damaged Lesson" })).toHaveCount(0);
  await expect(page.locator(".debug-console")).toContainText("LESSON_INVALID");
});
