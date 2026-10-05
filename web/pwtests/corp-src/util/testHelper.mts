/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { expect, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import path from "node:path";
import { expectVisibleWithin, waitForLocatorContentLoaded } from "../../util/testHelper";

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

// Checks availability without selecting either an existing repository or a clone option.
export async function checkRepoExists(page: Page, card: Locator, reponame: string): Promise<boolean> {
  const repoInput = card.getByRole("combobox", { name: "Select or type repo name..." });
  await repoInput.click();
  await waitForLocatorContentLoaded(page.getByRole("option"), "No options", "Repo list", 5000000);
  await repoInput.fill(reponame);
  const escapedRepoName = reponame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyClonedOption = page.getByRole("option", { name: new RegExp(`^(?:▪\\s*)?${escapedRepoName}$`, "i") });
  const cloneOption = page.getByRole("option", { name: new RegExp(`^Clone as [\"'“‘]${escapedRepoName}[\"'”’]$`) });

  await expect(alreadyClonedOption.or(cloneOption)).toBeVisible();
  const repoExists = await alreadyClonedOption.isVisible();
  await repoInput.press("Escape");
  return repoExists;
}

export async function chooseExistingRepo(page: Page, card: Locator, reponame: string): Promise<void> {
  const repoInput = card.getByRole("combobox", { name: "Select or type repo name..." });
  await repoInput.click();
  await waitForLocatorContentLoaded(page.getByRole("option"), "No options", "Repo list", 5000000);
  await repoInput.fill(reponame);
  const escapedRepoName = reponame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyClonedOption = page.getByRole("option", { name: new RegExp(`^(?:▪\\s*)?${escapedRepoName}$`, "i") });

  await expect(alreadyClonedOption).toBeVisible();
  await alreadyClonedOption.click();
  await expect(repoInput).toHaveValue(reponame);
  await expect(card.getByText("Valid", { exact: true })).toBeVisible();
}

export async function createNewRepo(page: Page, card: Locator, reponame: string): Promise<void> {
  const repoInput = card.getByRole("combobox", { name: "Select or type repo name..." });
  await repoInput.click();
  await waitForLocatorContentLoaded(page.getByRole("option"), "No options", "Repo list", 5000000);
  await repoInput.fill(reponame);
  const escapedRepoName = reponame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyClonedOption = page.getByRole("option", { name: new RegExp(`^(?:▪\\s*)?${escapedRepoName}$`, "i") });
  const cloneOption = page.getByRole("option", { name: new RegExp(`^Clone as [\"'“‘]${escapedRepoName}[\"'”’]$`) });

  await expect(alreadyClonedOption.or(cloneOption)).toBeVisible();
  if (await alreadyClonedOption.isVisible()) {
    throw new Error(`The repo "${reponame}" already exists. Please delete it from your GitHub account before running this test.`);
  }

  await expectVisibleWithin(cloneOption, `Clone as ${reponame}`, 500);
  await cloneOption.click();
  // Confirm the option click changed the application's state.
  await expect(cloneOption).toBeHidden();
  await expect(repoInput).toHaveAttribute("aria-expanded", "false");
  await expectVisibleWithin(card.getByText("Clone from template"), "Clone from template", 500);
  await expect(card.getByRole("button", { name: "Clone Repository" })).toBeVisible();
  await expect(card.getByRole("switch", { name: "Private" })).toBeChecked();
  await expect(card.getByRole("switch", { name: "Clone all branches" })).not.toBeChecked();
  await expect(card.getByRole("switch", { name: "Create environments" })).toBeChecked();
  await expect(card.getByText(/Pick the environment to configure/i)).toHaveCount(0);
  await card.getByRole("button", { name: "Clone Repository" }).click();
  await expectVisibleWithin(card.getByText("Pick the environment to configure."), "Text: Pick the environment to configure", 500_000);
}
