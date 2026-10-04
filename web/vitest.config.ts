/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { defineConfig, defineProject } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    projects: [
      defineProject({
        optimizeDeps: {
          include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
        },
        test: {
          name: "unit",
          include: ["*-src/test/**/*.{test,spec}.{ts,tsx,js,jsx}"],
          exclude: ["*-src/test/**/*.browser.{test,spec}.{ts,tsx,js,jsx}"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.js"],
          globals: true,
        },
      }),
      defineProject({
        optimizeDeps: {
          include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
        },
        test: {
          name: "web",
          include: ["*-src/test/**/*.browser.{test,spec}.{ts,tsx,js,jsx}"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
          globals: true,
        },
      }),
      defineProject({
        test: {
          name: "functions",
          include: ["backend/src/**/*.{test,spec}.{ts,tsx,js,jsx}"],
          environment: "node",
          globals: true,
        },
      }),
    ],
    passWithNoTests: true,
  },
});
