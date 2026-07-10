import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Sandboxed/remote environments pre-install a pinned Chromium at a stable
// path (and block browser downloads); elsewhere Playwright manages its own.
const preinstalledChromium = "/opt/pw-browsers/chromium";

// Real-stack E2E: anonymous local Convex deployment + Vite dev server
// (scripts/e2e-server.sh). One worker — the backend's data is shared across
// tests, so specs create uniquely-named DocTypes and never assert global
// empty states (those belong to the vitest integration matrix).
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    ...(existsSync(preinstalledChromium)
      ? { launchOptions: { executablePath: preinstalledChromium } }
      : {}),
  },
  webServer: {
    command: "bash scripts/e2e-server.sh",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
