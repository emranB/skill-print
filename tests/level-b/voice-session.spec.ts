import { expect, test, type Page } from "@playwright/test";
import { installTrackProbe, liveTracks } from "./support";

test.use({ permissions: ["microphone", "camera"] });

const SECRET_PATTERN = /sk_[A-Za-z0-9]{20,}|xi-api-key/;

async function connect(page: Page) {
  const status = page.getByTestId("voice-status");
  await page.getByLabel("Apprentice").selectOption("elevenlabs");
  await expect(status).toHaveText("Disconnected");
  await page.getByRole("button", { name: "Start Apprentice" }).click();
  await expect(status).toHaveText(/Connecting|Connected|Listening|Speaking/, { timeout: 5_000 });
  await expect(status).toHaveText(/Connected|Listening|Speaking/, { timeout: 30_000 });
  await expect(status).toHaveText(/Listening|Speaking/, { timeout: 30_000 });
  return status;
}

/** Tracks every voice WebSocket so the test can prove the session really closed. */
function watchSockets(page: Page) {
  const sockets = { open: 0, opened: 0 };
  page.on("websocket", (ws) => {
    if (!/elevenlabs/i.test(ws.url())) return;
    sockets.open += 1;
    sockets.opened += 1;
    ws.on("close", () => (sockets.open -= 1));
  });
  return sockets;
}

test("Start Apprentice opens a real voice session, Cancel to Home tears it down, Mock switch disconnects", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  await installTrackProbe(page);
  const sockets = watchSockets(page);
  await page.goto("/");

  const status = await connect(page);
  await page.getByRole("button", { name: /Teach a Skill/i }).click();
  await expect(status).toHaveText(/Connected|Listening|Speaking/);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(status).toHaveText("Disconnected", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Start Apprentice" })).toBeVisible();
  await expect.poll(() => sockets.open, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => (await liveTracks(page)).live, { timeout: 15_000 }).toEqual([]);

  await page.getByRole("button", { name: "Start Apprentice" }).click();
  await expect(status).toHaveText(/Listening|Speaking/, { timeout: 60_000 });
  await page.getByLabel("Apprentice").selectOption("mock");
  await expect(page.getByTestId("voice-status")).toHaveCount(0);
  await expect.poll(() => sockets.open, { timeout: 15_000 }).toBe(0);
  await expect.poll(async () => (await liveTracks(page)).live, { timeout: 15_000 }).toEqual([]);
  await expect(page.locator(".debug-console")).toContainText("VOICE_DISCONNECTED");
  expect(sockets.opened).toBeGreaterThanOrEqual(2);
  console.log(`VOICE sessionsOpened=${sockets.opened} socketsOpen=${sockets.open} micTracksSeen=${(await liveTracks(page)).total}`);

  expect(consoleText.join("\n")).not.toMatch(SECRET_PATTERN);
});
