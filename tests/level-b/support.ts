import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, type Page } from "@playwright/test";

export const SOURCE_VIDEO = path.resolve("data/lesson-squat.mp4");
/** First camera regime of the source video, which holds three full demonstrations. */
const FEED_START_SEC = 7;
const FEED_SECONDS = 15;
const FEED = path.resolve(`test-results/live-camera-feed-${FEED_START_SEC}s.mjpeg`);

/** Builds the MJPEG file Chromium replays as the fake camera; must run before the browser launches. */
export function ensureCameraFeed(): string {
  if (!fs.existsSync(FEED)) {
    if (!ffmpegPath) throw new Error("ffmpeg-static binary missing");
    fs.mkdirSync(path.dirname(FEED), { recursive: true });
    const out = spawnSync(
      ffmpegPath as unknown as string,
      ["-y", "-ss", String(FEED_START_SEC), "-t", String(FEED_SECONDS), "-i", SOURCE_VIDEO, "-an", "-r", "15", "-q:v", "5", "-f", "mjpeg", FEED],
      { encoding: "utf8" },
    );
    if (out.status !== 0) throw new Error(`ffmpeg failed: ${out.stderr?.slice(-400)}`);
  }
  return FEED;
}

export async function chooseCapture(page: Page, source: "live" | "upload" | "fixture"): Promise<void> {
  const id = source === "live" ? "source-camera" : `source-${source}`;
  await page.getByTestId(id).click();
}

export function fakeCameraLaunchArgs(): string[] {
  return [
    "--use-gl=angle",
    "--ignore-gpu-blocklist",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${ensureCameraFeed()}`,
  ];
}

/** Records every track handed out by getUserMedia so tests can prove devices were released. */
export async function installTrackProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      w.__tracks.push(...stream.getTracks());
      return stream;
    };
  });
}

export async function liveTracks(page: Page): Promise<{ total: number; live: string[] }> {
  return page.evaluate(() => {
    const tracks = (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks ?? [];
    return { total: tracks.length, live: tracks.filter((t) => t.readyState === "live").map((t) => t.kind) };
  });
}

export interface ShownEvent {
  event: string;
  data: unknown;
}

/** Reads the DebugBus events rendered in the debug console. */
export async function debugEvents(page: Page): Promise<ShownEvent[]> {
  return page.locator(".debug-row").evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector(".debug-event")?.textContent ?? "";
      const raw = row.querySelector(".debug-data")?.textContent;
      let data: unknown;
      try {
        data = raw ? JSON.parse(raw) : undefined;
      } catch {
        data = raw;
      }
      return { event: name.split(" ")[0] ?? "", data };
    }),
  );
}

export function countEvents(events: ShownEvent[], name: string): number {
  return events.filter((e) => e.event === name).length;
}

/** Asserts every device track is ended and every live pose loop that started has stopped. */
export async function expectDevicesReleased(page: Page): Promise<void> {
  await expect.poll(async () => (await liveTracks(page)).live, { timeout: 10_000 }).toEqual([]);
  await expect
    .poll(async () => {
      const events = await debugEvents(page);
      return countEvents(events, "LIVE_POSE_STARTED") - countEvents(events, "LIVE_POSE_STOPPED");
    })
    .toBe(0);
}

export async function passTeachCalibration(page: Page): Promise<void> {
  await page.getByPlaceholder(/blue river seven/i).fill("blue river seven");
  await page.getByRole("button", { name: /Confirm phrase/i }).click();
  await page.getByRole("button", { name: /^Continue$/i }).click({ timeout: 60_000 });
}
