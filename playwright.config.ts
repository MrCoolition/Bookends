import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://localhost:3000", browserName: "chromium", channel: "msedge", headless: true, viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure" },
  reporter: "list",
});
