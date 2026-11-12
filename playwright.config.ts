import { existsSync } from "node:fs";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// An installed Edge avoids downloading a second Chromium on Windows.
const channel =
  process.platform === "win32" &&
  existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")
    ? "msedge"
    : undefined;

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  retries: 0,
  maxFailures: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: "test-results/browser",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4179",
    channel,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    serviceWorkers: "block",
  },
  webServer: {
    command: "node scripts/browser-fixture-server.mjs",
    url: "http://127.0.0.1:4179/__qa/health",
    reuseExistingServer: false,
    timeout: 10_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
