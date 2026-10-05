/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/CoreInfraCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN, viewports } from "../../testInit";
import { expectSnapshot, expectVisibleWithin, safePathSegment } from "../../util/testHelper.ts";
import {
	expandAzureAppRegistrationCard,
	expandAzureLoginCard,
	expandAzureSubscriptionCard,
	expandRepoCard,
} from "../util/cardHelper.mts";
import { checkRepoExists, chooseExistingRepo, createNewRepo } from "../util/testHelper.mts";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "../util/setupHelper.mts";
import { coreInfraStepLabels, expectSuccessfulSteps } from "../util/mockTestHelper.mts";

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
	if (!(await checkRepoExists(page, repoCard, repoName))) {
		await createNewRepo(page, repoCard, repoName);
	}
	await chooseExistingRepo(page, repoCard, repoName);

	await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
	await repoCard.getByText("PROD", { exact: true }).click();
	const createBranchButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
	const subscriptionCard = await expandAzureSubscriptionCard(page);
	const selectEnvironmentMessage = subscriptionCard.getByText(
		"Select a repository & environment to save the tenant and subscription to GitHub.",
		{ exact: true },
	);
	await expect.poll(async () => await createBranchButton.isVisible() || await selectEnvironmentMessage.count() === 0, {
		timeout: 30_000,
		message: "PROD branch state did not finish loading",
	}).toBeTruthy();
	if (await createBranchButton.isVisible()) {
		await expect(createBranchButton).toBeEnabled();
		await createBranchButton.click();
		await expect(createBranchButton).toBeHidden({ timeout: 30_000 });
		await expect(repoCard.getByText("Failed to create branch", { exact: true })).toHaveCount(0);
	}

  await expect(selectEnvironmentMessage).toHaveCount(0);
  await expectVisibleWithin(subscriptionCard.getByText(/Pick the subscription to deploy into\./i), "Subscription card prompt", 50_000);
  await expect(subscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
  await expectVisibleWithin(subscriptionCard.getByRole("combobox"), "Azure subscription selector", 50_000);
  const subscriptionSelect = subscriptionCard.getByRole("combobox");
  await subscriptionSelect.click();
  const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
  await expectVisibleWithin(subscriptionOption, `Subscription ${SUBSCRIPTION_ID} option`, 50_000);
  await subscriptionOption.click();
  await expect(subscriptionCard.getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
  const pendingSave = subscriptionCard.getByRole("button", { name: /^Save [12] variables?$/ });
  const cleanSave = subscriptionCard.getByRole("button", { name: "Save variables", exact: true });
  if (await pendingSave.count()) {
    await pendingSave.click();
  }
  await expect(cleanSave).toBeDisabled({ timeout: 60_000 });

  const appRegistrationCard = await expandAzureAppRegistrationCard(page);
  const coreInfraCard = page.locator("#card-core_infra");
  await coreInfraCard.getByText("Terraform state backend", { exact: true }).click();
  const appRegistrationRequirement = coreInfraCard.getByText("Complete the Azure app registration", { exact: true });
  const connectionInputs = appRegistrationCard.locator('[data-sensitive="true"] input');
  await expect(connectionInputs).toHaveCount(2, { timeout: 50_000 });
  await expect
    .poll(
      async () =>
        !(await appRegistrationRequirement.isVisible()) ||
        (await appRegistrationCard
          .getByText(/\d+ not configured|doesn't exist in the selected tenant|Missing on the selected subscription|doesn't match AZURE_CLIENT_ID/i)
          .count()) > 0,
      { timeout: 60_000 }
    )
    .toBe(true);
  if (await appRegistrationRequirement.isVisible()) {
    const appNameInput = appRegistrationCard.locator("input:visible").first();
    await expectVisibleWithin(appNameInput, "App registration name input", 50_000);
    await appNameInput.fill(safePathSegment(`zeninstaller-${repoName}-${Date.now().toString(36)}`));
    await appRegistrationCard.getByRole("button", { name: /^(?:Create app registration|Grant access on this subscription)$/ }).click();
    await expectVisibleWithin(appRegistrationCard.getByRole("button", { name: "Try again" }), "App registration completion", 300_000);
    await expectVisibleWithin(
      appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i),
      "Saved app registration connection details",
      60_000
    );
  }
  await expect(appRegistrationRequirement).toBeHidden({ timeout: 60_000 });
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
  test.describe(`Core Infrastructure Card - ${viewportName}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 });

    test("Happy path", async ({ page, context }, testInfo) => {
      test.setTimeout(600_000);
      const companyShortCode = "pwtests";
      let setupAlreadyExists = false;

      await test.step("Prepare the selected Azure subscription", async () => {
        await prepareExistingAzureSubscription(page, context, viewportName);
      });

      const terraformCard = page.locator("#card-core_infra");

      await test.step("Open backend card where core infrastructure does not exist", async () => {
        await expectVisibleWithin(terraformCard.getByText("Company short code"), "Company short code field", 50_000);

        setupAlreadyExists = await terraformCard
          .getByRole("button", { name: "Re-run setup" })
          .isVisible()
          .catch(() => false);
        if (setupAlreadyExists) {
          await expectVisibleWithin(terraformCard.getByRole("button", { name: "Re-run setup" }), "Re-run setup button", 50_000);
          await expectSnapshot(page, terraformCard, testInfo, "already-existing-start", viewportName);
        } else {
          await terraformCard.getByText("COMPANY_SHORT_CODE", { exact: true }).locator("../..").getByRole("textbox").fill(companyShortCode);
          const saveVariablesButton = terraformCard.getByRole("button", { name: /^Save\s+(?:\d+\s+)?variables?$/ });
          if (await saveVariablesButton.isEnabled()) {
            await saveVariablesButton.click();
            await expect(terraformCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled({ timeout: 60_000 });
          }
          await expectVisibleWithin(terraformCard.getByText("Create core infrastructure"), "Create core infrastructure button", 50_000);
          await expectSnapshot(page, terraformCard, testInfo, "not-setup-start", viewportName);
        }
      });

      if (setupAlreadyExists) {
        await test.step.skip("Provision the Terraform state backend", async () => {});
      } else {
        await test.step("Provision the Terraform state backend", async () => {
          const card = page.locator("#card-core_infra");
          await card.getByRole("button", { name: "Create core infrastructure" }).click();
          await expect(card.getByText("Running...", { exact: true })).toBeHidden({ timeout: 500_000 });

          await expectSuccessfulSteps(card, coreInfraStepLabels(companyShortCode));
          await expectVisibleWithin(card.getByRole("button", { name: "Start over" }), "Start over button", 50_000);
          await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
          await expectSnapshot(page, card, testInfo, "provisioned", viewportName);
        });
      }

      await test.step("Verify the completed card state", async () => {
        let card = page.locator("#card-core_infra");
        const resources = card.getByText("Resources", { exact: true });
        if (!(await resources.isVisible().catch(() => false))) {
          await card.getByRole("button", { name: "Start over" }).click();
          await page.reload();
          card = page.locator("#card-core_infra");
          if (
            !(await card
              .getByText("Company short code")
              .isVisible()
              .catch(() => false))
          ) {
            await card.getByText("Terraform state backend", { exact: true }).click();
          }
        }
        await expectVisibleWithin(card.getByText("Terraform state backend"), "Terraform state backend title", 50_000);
        await expectVisibleWithin(card.getByText("Location:"), "State container label", 50_000);
        await expectVisibleWithin(card.getByRole("button", { name: "Re-run setup" }), "Re-run setup button", 50_000);
        await expectSnapshot(page, card, testInfo, "end", viewportName);
      });

      await test.step("Re-run existing core infrastructure setup", async () => {
        const card = page.locator("#card-core_infra");
        const resources = card.getByText("Resources", { exact: true });

        if (!(await resources.isVisible().catch(() => false))) {
          await card.getByRole("button", { name: "Start over" }).click();
        }

        await expectVisibleWithin(resources, "Infrastructure resources", 50_000);
        const rerunButton = card.getByRole("button", { name: "Re-run setup" });
        await expectVisibleWithin(rerunButton, "Re-run setup button", 50_000);
        await rerunButton.click();
        await expect(card.getByText("Running...", { exact: true })).toBeHidden({ timeout: 500_000 });
        await expectSuccessfulSteps(card, coreInfraStepLabels("pwtests"));
        await expectVisibleWithin(card.getByText("Already exists", { exact: true }).first(), "Already exists status", 50_000);
        await expectVisibleWithin(card.getByRole("button", { name: "Start over" }), "Start over button", 50_000);
        await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
        await expectSnapshot(page, card, testInfo, "rerun-complete", viewportName);
      });
    });
  });
}
