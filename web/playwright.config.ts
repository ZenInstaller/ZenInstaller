/// <reference types="node" />

import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, } from "node:url";

process.env.NODE_ENV = process.env.NODE_ENV || 'dev';
// Enable Playwright API logs for normal and coverage runs, preserving other namespaces.
process.env.DEBUG = [process.env.DEBUG, 'pw:api'].filter(Boolean).join(',');
const currentFilePath = fileURLToPath(import.meta.url,);
const currentDirectory = path.dirname(currentFilePath,);
dotenv.config({ path: path.resolve(currentDirectory, ".env",), });


export default defineConfig({
  testDir: "./pwtests",
  outputDir: "./pwtests/test-results",
  updateSnapshots: process.env.CI ? "none" : "missing",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    // A terminal reporter is what streams worker stdout/stderr (incl. pw:api) to the console.
    ["line"],
    ["html", { outputFolder: './pwtests/playwright-report', open: "never" }],
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000,

    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.02,
      pathTemplate: "{testDir}/{arg}{ext}"
    },
  },

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    testIdAttribute: "data-id",
  },

  projects: [
    {
      name: "Setup Corp Github Auth",
      testMatch: /github-pat-login\.setup\.mts/,
      fullyParallel: false,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    {
      name: "Setup Corp Azure Login",
      testMatch: /corp-src\/setup\/azure-login\.setup\.mts/,
      fullyParallel: false,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
      },
    },

    {
      name: "Test Corp",
      testMatch: /corp-src\/.*\.spec\.mts/,
      fullyParallel: false,
      workers: 1,
      retries: 1,
      use: {
        ...devices["Desktop Chrome"],
      },
      dependencies: ["Setup Corp Github Auth", "Setup Corp Azure Login"],
    },

  ],

  /**
   * Start the server automatically
   */
  webServer: {
    command: "pnpm run dev",
    url: process.env.BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

