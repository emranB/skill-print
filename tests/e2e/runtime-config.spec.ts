import { test, expect } from "@playwright/test";

test("debug console receives APPLICATION_STARTED", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("APPLICATION_STARTED").first()).toBeVisible({ timeout: 15_000 });
});
