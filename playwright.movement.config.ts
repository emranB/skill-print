import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/movement", outputDir: "test-results/playwright-movement", workers: 1, timeout: 20 * 60 * 1000,
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-gl=angle", "--ignore-gpu-blocklist"] } } }],
  webServer: { command: "npm run dev", env: { SKILLPRINT_APPRENTICE_DEFAULT: "mock" }, url: "http://localhost:5173", reuseExistingServer: true, timeout: 120_000 },
});
