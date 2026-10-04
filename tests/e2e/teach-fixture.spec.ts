import { test, expect, type Page } from "@playwright/test";

async function teachFixtureToReview(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("source-fixture").click();
  await page.getByRole("button", { name: /Teach a Skill/i }).click();
  await expect(page.getByText(/Teach calibration/i)).toBeVisible();
  await page.getByPlaceholder(/blue river seven/i).fill("blue river seven");
  await page.getByRole("button", { name: /Confirm phrase/i }).click();
  await page.getByRole("button", { name: /^Continue$/i }).click();
  await page.getByPlaceholder(/Controlled movement/i).fill(name);
  await page.getByRole("button", { name: /^Continue$/i }).click();
  await page.getByRole("button", { name: /Capture reference pose/i }).click();
  await page.getByRole("button", { name: /^Start recording$/i }).click();
  // TEACH_RECORDING: fixture start auto-completes into review
  await page.getByRole("button", { name: /^Start recording$/i }).click();
  await expect(page.getByRole("button", { name: /Analyze/i })).toBeVisible({ timeout: 20_000 });
}

/** Answers every capture and debrief question, keeps the teach-back and submits. */
async function answerReviewAndSubmit(page: Page) {
  const captureAnswer = page.getByPlaceholder("Explain what mattered in this moment");
  for (let i = 0; i < 20 && (await captureAnswer.isVisible().catch(() => false)); i += 1) {
    await captureAnswer.fill(`SIMULATED TEST RESPONSE: capture answer ${i + 1}`);
    await page.getByRole("button", { name: /Next question|Continue to debrief/ }).click();
  }
  const debrief = page.locator(".debrief textarea");
  for (let i = 0; i < 20 && !(await page.getByRole("heading", { name: "Teach-back" }).isVisible()); i += 1) {
    if (await debrief.isVisible().catch(() => false)) {
      await debrief.fill(`SIMULATED TEST RESPONSE: debrief answer ${i + 1}`);
      await page.getByRole("button", { name: /^(Next|Teach-back)$/ }).click();
    } else {
      await page.getByRole("button", { name: /Continue to teach-back/ }).click();
    }
  }
  await page.getByRole("button", { name: "Keep all remaining" }).click();
  await page.getByRole("button", { name: /Confirm teach-back/ }).click();
  await expect(page.getByRole("button", { name: "Submit lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Submit lesson" }).click();
  await expect(page.getByRole("heading", { name: "Lesson saved" })).toBeVisible({ timeout: 15_000 });
}

test("fixture teach path reaches recording review", async ({ page }) => {
  test.setTimeout(90_000);
  await teachFixtureToReview(page, "Motion Cycle A");
});

test("fixture lesson survives reload and a fixture student completes a rep", async ({ page }) => {
  test.setTimeout(180_000);
  const name = `Fixture Cycle ${Date.now()}`;
  await teachFixtureToReview(page, name);
  await page.getByRole("button", { name: /Analyze/i }).click();
  await answerReviewAndSubmit(page);

  await page.reload();
  await page.getByTestId("source-fixture").click();
  await page.getByRole("button", { name: /Learn a Skill/i }).click();
  await page.getByRole("button", { name }).first().click();
  await page.getByRole("button", { name: /^Continue$/i }).click({ timeout: 30_000 });
  await page.locator(".learn-start textarea").fill("SIMULATED TEST RESPONSE: prediction");
  await page.getByRole("button", { name: "Start lesson" }).click();
  await page.getByRole("button", { name: "Begin attempt" }).click();

  await expect(page.getByTestId("ghost-teacher")).toHaveAttribute("data-rendered", "true");
  await expect(page.getByTestId("ghost-student")).toHaveAttribute("data-rendered", "true", { timeout: 15_000 });
  await expect(page.getByTestId("learn-progress")).toHaveText(/reps [1-9]/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Finish lesson" }).click();
  await expect(page.locator(".debug-console")).toContainText("REP_SUCCESS");
});
