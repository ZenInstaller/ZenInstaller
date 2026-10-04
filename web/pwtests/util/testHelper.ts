/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { expect, Locator, Page, Route, TestInfo } from "@playwright/test";
import path from "node:path";

// printing debug and API info when running test
const isDebugEnabled = process.env.DEBUG?.includes("pw:api") || process.env.NODE_ENV === "development";

export type PageSnapshotOptions = {
  userId: string;
  viewportName: string;
  testFolder?: string;
  mask?: Locator[];
  stabilizeAuth?: boolean;
};

// Returns sensitive identity fields contained by the supplied page or locator.
export function sensitiveTextMasks(root: Page | Locator): Locator[] {
  return [root.locator('[data-sensitive="true"]')]; //TODO: filter out items not visible on UI
}

// Normalizes arbitrary strings into stable snapshot path segments.
export function safePathSegment(value: string): string {
  const safeValue = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return safeValue || "unnamed";
}

function snapshotPath(testInfo: TestInfo, viewportName: string, fileSubstring: string): string[] {
  const testName = safePathSegment(testInfo.title);
  let snapshotName = safePathSegment(`${fileSubstring}.png`);
  if (testName.toLowerCase() == "happy-path") {
    snapshotName = safePathSegment(`${testName}-${fileSubstring}.png`);
  }
  const relativeTestPath = path.relative(testInfo.project.testDir, testInfo.file);
  const testPathSegments = relativeTestPath.split(path.sep).map((segment) => safePathSegment(segment));
  const testFile = testPathSegments.pop()?.replace(/\.spec\.(?:m?[jt]sx?)$/, "") ?? "unnamed";
  const sourceFolder = testPathSegments.shift();

  return [
    ...(sourceFolder ? [sourceFolder] : []),
    "snapshots",
    ...testPathSegments,
    safePathSegment(testFile),
    safePathSegment(viewportName),
    safePathSegment(snapshotName.endsWith(".png") ? snapshotName : safePathSegment(`${snapshotName}.png`)),
  ];
}

// takes snapshot of a specific card element, rather than the whole page
export async function expectSnapshot(page: Page, locator: Locator, testInfo: TestInfo, snapshotName: string, viewportName: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .locator("body")
    .evaluate(async () => document.fonts?.ready)
    .catch(() => undefined);
  await page.waitForTimeout(300).catch(() => undefined);

  const relativeSnapshotPath = snapshotPath(testInfo, viewportName, snapshotName);
  const originalStyle = await locator.evaluate((element) => element.getAttribute("style"));
  const screenshotStyle = await page.addStyleTag({
    content: "html { scrollbar-width: none !important; } html::-webkit-scrollbar { display: none !important; }",
  });

  try {
    await locator.evaluate((element) => {
      const cardElement = element as HTMLElement;
      cardElement.style.position = "fixed";
      cardElement.style.inset = "0";
      cardElement.style.width = "100vw";
      cardElement.style.height = "auto";
      cardElement.style.maxWidth = "100vw";
      cardElement.style.maxHeight = "none";
      cardElement.style.overflow = "visible";
      cardElement.style.zIndex = "2147483647";
      cardElement.style.borderRadius = "0";
    });

    await expect(locator).toHaveScreenshot(relativeSnapshotPath, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.02,
      mask: sensitiveTextMasks(locator) ?? [],
      maskColor: "rgb(0, 0, 0)",
    });
  } finally {
    await screenshotStyle.evaluate((element) => element.parentNode?.removeChild(element));
    await locator.evaluate((element, style) => {
      if (style === null) {
        element.removeAttribute("style");
      } else {
        element.setAttribute("style", style);
      }
    }, originalStyle);
  }
}

export async function logMockAPI(page: Page, route: Route, status: number, body: unknown) {
  const message = `Mock Route Method : ${route.request().method()} , URL : ${route.request().url()} | Fulfilled with ${status} | Body: ${body}`;
  if (isDebugEnabled) {
    console.log(message);
  }
}

export async function expectVisibleWithin(locator: Locator, label: string, timeoutMs = 500) {
  const start = performance.now();
  try {
    await expect(locator).toBeVisible({ timeout: timeoutMs });
  } finally {
    const elapsedMs = performance.now() - start;
    console.log(`${label} visible in ${elapsedMs.toFixed(1)}ms (timeout ${timeoutMs}ms)`);
  }
}

export async function waitForLocatorContentLoaded(locator: Locator, emptyPlaceholder = "No options", label: string, timeoutMs = 500) {
  await expect
    .poll(
      async () => {
        const texts = (await locator.allTextContents()).map((value) => value.trim()).filter(Boolean);
        if (!texts.length) {
          return false;
        }
        if (texts.length === 1 && texts[0] === emptyPlaceholder) {
          return false;
        }
        return true;
      },
      {
        timeout: timeoutMs,
        message: `${label} content did not load`,
      }
    )
    .toBeTruthy();
}
