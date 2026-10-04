/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/AzureLogin/AzureLoginCard.tsx
import { expect, test } from "@playwright/test";
import { restoreAzureSessionStorage } from "../util/setupHelper.mts";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot, expectVisibleWithin } from "../../util/testHelper.ts";
import { expandAzureLoginCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
  test.describe(`Azure Login Card - ${viewportName}`, () => {
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

    test("Happy path", async ({ page, context }, testInfo) => {
      await page.goto(CORP_URL);

      const azureCard = await test.step("Expand Unauthenticated Azure Login Card", async () => {
        const azureCard = await expandAzureLoginCard(page);
        await expect(azureCard.getByRole("button", { name: "Sign in with Azure" })).toBeVisible();
        await expectSnapshot(page, azureCard, testInfo, "start", viewportName);
        return azureCard;
      });

      await test.step("Shows authenticated Azure card and selects a tenant", async () => {
        await restoreAzureSessionStorage(context);
        await page.reload();
        await expectVisibleWithin(azureCard.getByText(/Signed in as/i), "Azure signed-in status", 50_000);
        await expectVisibleWithin(azureCard.getByTestId("txtAzureUsername"), "Azure username", 50_000);
        await expectVisibleWithin(azureCard.getByRole("button", { name: "Sign out", exact: true }), "Sign out button", 50_000);
        await expect(azureCard.getByRole("button", { name: "Sign in with Azure", exact: true })).toHaveCount(0);
        await expectVisibleWithin(azureCard.getByText(/^Tenant/), "Tenant label", 50_000);
        await expectVisibleWithin(azureCard.getByRole("combobox"), "Stored tenant selector", 50_000);

        // re-selects tenant to actually confirm correctly selected id
        const tenantSelect = azureCard.getByTestId("tenant-select");
        await expect.poll(async () => (await tenantSelect.locator("input").inputValue()).trim(), { timeout: 50_000 }).not.toBe("");
        const tenantId = (await tenantSelect.locator("input").inputValue()).trim();
        await tenantSelect.click();
        await page.getByRole("option").filter({ hasText: tenantId }).click();
        await expect(tenantSelect.locator("input")).toHaveValue(tenantId);

        const subscriptionCard = page.locator("#card-azure_subscription");
        const requirements = subscriptionCard.getByText("Complete these first");
        if (!(await requirements.isVisible())) {
          await subscriptionCard.getByText("Choose Azure subscription").click();
        }
        await expect(requirements).toBeVisible();
        await expect(subscriptionCard.getByText("Select a tenant")).toHaveCount(0, { timeout: 50_000 });

        await expectSnapshot(page, azureCard, testInfo, "end", viewportName);
      });
    });

    test("Signing Out button logs out current user", async ({ page, context }, testInfo) => {
      await restoreAzureSessionStorage(context);
      await page.goto(CORP_URL);
      const azureCard = await expandAzureLoginCard(page);
      await expectVisibleWithin(azureCard.getByText(/Signed in as/i), "Azure signed-in status", 50_000);
      await azureCard.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(azureCard.getByText(/Signed in as/i)).toHaveCount(0);
      await expectSnapshot(page, azureCard, testInfo, "signed-out", viewportName);
    });
  });
}
