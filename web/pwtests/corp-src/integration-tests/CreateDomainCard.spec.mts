/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/CreateDomainCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN, viewports } from "../../testInit";
import { expectSnapshot, expectVisibleWithin, safePathSegment } from "../../util/testHelper.ts";
import { expandAzureLoginCard, expandAzureSubscriptionCard, expandRepoCard } from "../util/cardHelper.mts";
import { checkRepoExists, chooseExistingRepo } from "../util/testHelper.mts";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "../util/setupHelper.mts";

async function prepareExistingAzureSubscription(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  viewportName: string
) {
  await restoreGithubSessionStorage(context);
  await restoreAzureSessionStorage(context);
  await page.goto(CORP_URL);

  const azureCard = await expandAzureLoginCard(page);
  const tenantSelect = azureCard.getByTestId("tenant-select");
  await expectVisibleWithin(tenantSelect, "Azure tenant selector", 50_000);
  const tenantId = (await tenantSelect.locator("input").inputValue()).trim();
  expect(tenantId, "The restored Azure tenant ID should not be empty").not.toBe("");
  await tenantSelect.click();
  await page.getByRole("option").filter({ hasText: tenantId }).click();

  const repoCard = await expandRepoCard(page);
  const repoName = safePathSegment(`${TEST_REPO_MAIN}-${viewportName}`);
  expect(await checkRepoExists(page, repoCard, repoName), `Expected the repository "${repoName}" to already exist`).toBe(true);
  await chooseExistingRepo(page, repoCard, repoName);

  await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
  await repoCard.getByText("PROD", { exact: true }).click();
  const createBranchButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
  if (await createBranchButton.isVisible()) {
    await createBranchButton.click();
    await expect(createBranchButton).toBeHidden({ timeout: 30_000 });
  }

  const subscriptionCard = await expandAzureSubscriptionCard(page);
  await expect(subscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
  await expectVisibleWithin(subscriptionCard.getByRole("combobox"), "Azure subscription selector", 50_000);
  const subscriptionSelect = subscriptionCard.getByRole("combobox");
  await subscriptionSelect.click();
  const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
  await expectVisibleWithin(subscriptionOption, `Subscription ${SUBSCRIPTION_ID} option`, 50_000);
  await subscriptionOption.click();

  const saveButton = subscriptionCard.getByRole("button", { name: /^Save(?: 2)? variables$/ });
  if ((await saveButton.count()) > 0 && (await saveButton.isEnabled({ timeout: 0 }))) {
    await saveButton.click();
    await expect(subscriptionCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled({ timeout: 60_000 });
  }
}

test.beforeEach(async ({ page }) => {
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
});

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;

  const entries = await page.coverage.stopJSCoverage();
  const file = testInfo.outputPath("v8-coverage.json");
  await writeFile(file, JSON.stringify(entries), "utf8");
  await testInfo.attach("v8-coverage", {
    path: file,
    contentType: "application/json",
  });
});

for (const [viewportName, viewport] of Object.entries(viewports)) {
  test.describe(`Create Domain Card - ${viewportName}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 });

    test("Happy path", async ({ page, context }, testInfo) => {
      test.setTimeout(600_000);

      await test.step("Prepare the selected Azure subscription", async () => {
        await prepareExistingAzureSubscription(page, context, viewportName);
      });

      const card = page.locator("#card-create_domain");
      await test.step("Open the Corp domain card", async () => {
        await card.getByText("Corp domain", { exact: true }).first().click();
        await expectVisibleWithin(card.getByText("Corp domain"), "Corp domain card title", 50_000);
        await expectVisibleWithin(card.getByText(/Creates the DNS zone for/i), "Domain setup description", 50_000);
        await expectSnapshot(page, card, testInfo, "start", viewportName);
      });

      await test.step("Set up or reuse the Corp domain", async () => {
        const setupButton = card.getByRole("button", { name: /^(?:Set up corp domain|Re-run setup)$/ });
        await expectVisibleWithin(setupButton, "Corp domain setup button", 50_000);
        await setupButton.click();
        await expect(card.getByText("Running...", { exact: true })).toBeHidden({ timeout: 500_000 });

        for (const stepLabel of [
          "Confirm Microsoft permissions",
          "Register required Azure resource providers",
          "Add custom domain to Entra ID",
          "Create domain-verification TXT record",
          "Set as primary domain",
          "Grant domain permission to the pipeline",
        ]) {
          await expectVisibleWithin(card.getByText(stepLabel, { exact: true }), `Domain setup step: ${stepLabel}`, 50_000);
        }
        await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
        await expectVisibleWithin(card.getByRole("button", { name: "Start over" }), "Start over button", 50_000);
        await expectSnapshot(page, card, testInfo, "setup-complete", viewportName);
      });

      await test.step("Verify the domain card completion state", async () => {
        await expectVisibleWithin(card.getByText("Resources", { exact: true }), "Domain resources section", 50_000);
        await expectVisibleWithin(card.getByText(/DNS zone:/i), "DNS zone details", 50_000);
        await expectSnapshot(page, card, testInfo, "end", viewportName);
      });
    });
  });
}
