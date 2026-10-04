import { test, expect } from "@playwright/test";

test("home shows teach and learn entry points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SkillPrint").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Teach a Skill/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Learn a Skill/i })).toBeVisible();
  await expect(page.getByText("Debug / Logs")).toBeVisible();
});
