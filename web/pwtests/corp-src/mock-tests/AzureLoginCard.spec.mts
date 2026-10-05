/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/AzureLogin/AzureLoginCard.tsx
import { expect, test } from "@playwright/test";
import { installMockAzure, signInMockAzure } from "../util/mockTestHelper.mts";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { expandAzureLoginCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
  test.describe(`Azure Login Card Mock - ${viewportName}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 });

    test.beforeEach(async ({ page }) => {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
    });

    test.afterEach(async ({ page }, testInfo) => {
      if (page.isClosed()) {
        return;
      }

      const entries = await page.coverage.stopJSCoverage();
      const file = testInfo.outputPath("v8-coverage.json");
      await writeFile(file, JSON.stringify(entries), "utf8");
      await testInfo.attach("v8-coverage", {
        path: file,
        contentType: "application/json",
      });
    });

    test("Happy path", async ({ page }, testInfo) => {
      const card = await test.step("Expand unauthenticated Azure login card", async () => {
        await page.goto(CORP_URL);
        const result = await expandAzureLoginCard(page);
        await expectSnapshot(page, result, testInfo, "start", viewportName);
        return result;
      });

      await test.step("Signs in and selects the mocked tenant", async () => {
        await installMockAzure(page);
        await signInMockAzure(page);
        await expect(card.getByText(/Signed in as/i)).toBeVisible();
        await expect(card.getByTestId("txtAzureUsername")).toHaveText("mock-user@example.com");
        const tenantSelect = card.getByTestId("tenant-select");
        await expect(tenantSelect).toBeVisible();
        await tenantSelect.click();
        await page.getByRole("option", { name: /Mock tenant/i }).click();
        await expect(card.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
        await expect(card.getByRole("button", { name: "Sign in with Azure", exact: true })).toHaveCount(0);
        await expectSnapshot(page, card, testInfo, "end", viewportName);
      });
    });

    test("Signing Out button logs out current user", async ({ page }, testInfo) => {
      await page.goto(CORP_URL);
      await installMockAzure(page);
      const card = await expandAzureLoginCard(page);
      await signInMockAzure(page);
      await expect(card.getByText(/Signed in as/i)).toBeVisible();
      await card.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(card.getByText(/Signed in as/i)).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Sign in with Azure", exact: true })).toBeVisible();
      await expectSnapshot(page, card, testInfo, "signed-out", viewportName);
    });
  });
}
