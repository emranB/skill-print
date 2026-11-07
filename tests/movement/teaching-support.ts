import { expect, type Page } from "@playwright/test";

export async function submitReview(page: Page, excludeFirst = false) {
  const capture = page.getByPlaceholder("Explain what mattered in this moment");
  const debrief = page.locator(".debrief textarea");
  const teachBack = page.getByRole("heading", { name: "Teach-back" });
  const skip = page.getByRole("button", { name: /Continue to teach-back/ });
  await expect(capture.or(debrief).or(teachBack).or(skip).first()).toBeVisible({ timeout: 120000 });
  for (let i = 0; i < 20 && (await capture.isVisible()); i++) {
    await capture.fill(`SIMULATED TEST RESPONSE: teacher capture ${i + 1}`);
    await page.getByRole("button", { name: /Next question|Continue to debrief/ }).click();
  }
  for (let i = 0; i < 20; i++) {
    await expect(debrief.or(teachBack).or(skip).first()).toBeVisible({ timeout: 60000 });
    if (await teachBack.isVisible()) break;
    if (await debrief.isVisible()) {
      await debrief.fill(`SIMULATED TEST RESPONSE: teacher debrief ${i + 1}`);
      await page.getByRole("button", { name: /^(Next|Teach-back)$/ }).click();
    } else await skip.click();
  }
  await page.getByRole("button", { name: "Keep all remaining" }).click();
  await page.getByRole("button", { name: /Confirm teach-back/ }).click();
  const executions = page.getByRole("region", { name: "Teacher executions" }).getByRole("checkbox");
  if (await executions.count()) {
    for (let i = 0; i < (await executions.count()); i++)
      if (await executions.nth(i).isEnabled()) await executions.nth(i).uncheck();
    await expect(page.getByRole("button", { name: "Submit lesson" })).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("Select at least one usable execution");
    for (let i = 0; i < (await executions.count()); i++)
      if (await executions.nth(i).isEnabled()) await executions.nth(i).check();
    if (excludeFirst)
      await page
        .getByRole("region", { name: "Teacher executions" })
        .locator('input[type="checkbox"]:enabled')
        .first()
        .uncheck();
  }
  await expect(page.getByRole("button", { name: "Submit lesson" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Submit lesson" }).click();
  await expect(page.getByRole("heading", { name: "Lesson saved" })).toBeVisible({ timeout: 30000 });
}
