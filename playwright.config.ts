import { defineConfig, devices } from "@playwright/test";

/** Set to test an already running app (for example the Docker container) instead of the dev server. */
const externalBaseUrl = process.env.SKILLPRINT_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        env: { SKILLPRINT_APPRENTICE_DEFAULT: "mock" },
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
