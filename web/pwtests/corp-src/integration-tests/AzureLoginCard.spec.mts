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

    test.beforeEach(async ({ page, },) => {
      await page.coverage.startJSCoverage({ resetOnNavigation: false, });
    });
    
    test.afterEach(async ({ page, }, testInfo,) => {
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

      test("Happy path", async ({ page, context, }, testInfo) => {
            await page.goto(CORP_URL);

            const azureCard = await test.step("Expand Unauthenticated Azure Login Card", async () => {
                const azureCard = await expandAzureLoginCard(page);
                await expectSnapshot(page, azureCard, testInfo, "start", viewportName);
                return azureCard;
            });

            await test.step("Shows authenticated Azure card and selects a tenant", async () => {
              await restoreAzureSessionStorage(context);
              await page.reload();
              await expect(azureCard.getByText(/Signed in as/i)).toBeVisible();
              await expect(azureCard.getByTestId("txtAzureUsername")).toBeVisible();
              await expect(azureCard.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
              await expect(azureCard.getByRole("button", { name: "Sign in with Azure", exact: true })).toHaveCount(0);
              await expect(azureCard.getByText(/^Tenant/)).toBeVisible();
              await expectVisibleWithin(azureCard.getByRole("combobox"), "Combobox: Load already stored tenant id.", 500000);

              await expectSnapshot(page, azureCard, testInfo, "end", viewportName);

            });
      });

      test("Signing Out button logs out current user", async ({ page, context }, testInfo) => {
        await restoreAzureSessionStorage(context);
        await page.goto(CORP_URL);
        const azureCard = await expandAzureLoginCard(page);
        await expect(azureCard.getByText(/Signed in as/i)).toBeVisible();
        await azureCard.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(azureCard.getByText(/Signed in as/i)).toHaveCount(0);
        await expectSnapshot(page, azureCard, testInfo, "signed-out", viewportName);
      });

    });
}
