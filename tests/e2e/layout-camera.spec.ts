import { expect, test } from "@playwright/test";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

test("camera on and off work from Home, and logs slide out of the way", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("camera-status")).toHaveText("Camera off");
  await page.getByTestId("camera-on").click();
  await expect(page.getByTestId("camera-status")).toHaveText("Camera on", { timeout: 15_000 });
  await page.getByTestId("camera-off").click();
  await expect(page.getByTestId("camera-status")).toHaveText("Camera off");

  await expect(page.getByText("Debug / Logs")).toBeVisible();
  await page.getByTestId("logs-hide").click();
  await expect(page.getByTestId("logs-open")).toBeVisible();
  await page.getByTestId("logs-open").click();
  await expect(page.getByText("Debug / Logs")).toBeVisible();

  await page.getByTestId("source-upload").click();
  await expect(page.getByTestId("camera-controls")).toHaveCount(0);
  await expect(page.getByTestId("upload-video-input")).toBeVisible();
  await page.getByTestId("source-camera").click();
  await expect(page.getByTestId("camera-controls")).toBeVisible();
  await expect(page.getByTestId("upload-video-input")).toHaveCount(0);

  await page.getByTestId("source-upload").click();
  await page.getByTestId("upload-video-input").setInputFiles({
    name: "demo.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("not-a-real-video"),
  });
  await expect(page.getByTestId("upload-video-name")).toHaveText("demo.mp4");
  await expect(page.getByTestId("upload-video-submit")).toBeVisible();
});
