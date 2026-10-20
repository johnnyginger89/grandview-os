import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a preinstalled Chromium when present (e.g. cloud dev containers).
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", screenshot: "only-on-failure", trace: "retain-on-failure", launchOptions },
  projects: [
    // Signs each role in once (the real login rate limit is 5/min) and saves the session.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions }, grepInvert: /@mobile/ },
    { name: "mobile", dependencies: ["setup"], use: { ...devices["Pixel 7"], launchOptions }, grep: /@mobile/ },
  ],
});
