/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/AzureSubscriptionCard.tsx
import { writeFile } from "node:fs/promises";
import { BrowserContext, expect, Locator, Page, test } from "@playwright/test";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "../util/setupHelper.mts";
import { checkRepoExists, chooseExistingRepo, createNewRepo } from "../util/testHelper.mts";
import { expectSnapshot, safePathSegment, expectVisibleWithin } from "../../util/testHelper.ts";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN, viewports } from "../../testInit";
import { expandAzureLoginCard, expandAzureSubscriptionCard, expandRepoCard } from "../util/cardHelper.mts";

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

export async function openExistingAzureSubscription(
  page: Page,
  context: BrowserContext,
  viewportName: string,
  options: {
    environmentName?: "PROD" | "TEST";
    expectSavedVariables?: boolean;
  } = {}
): Promise<{
  azureSubscriptionCard: Locator;
  tenantVariableInput: Locator;
  subscriptionVariableInput: Locator;
  saveButton: Locator;
}> {
  const { environmentName = "PROD", expectSavedVariables = true } = options;
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
  const repoExists = await checkRepoExists(page, repoCard, repoName);
  if (repoExists) {
    await chooseExistingRepo(page, repoCard, repoName);
  }
  expect(repoExists, `Expected the repository "${repoName}" to already exist`).toBe(true);

  await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
  const environment = repoCard.getByText(environmentName, { exact: true });
  await expectVisibleWithin(environment, `${environmentName} environment`, 50_000);
  await environment.click();

  const azureSubscriptionCard = await expandAzureSubscriptionCard(page);
  const createBranchButton = repoCard.getByRole("button", { name: `Create New Branch: ${environmentName}` });
  const selectEnvironmentMessage = azureSubscriptionCard.getByText("Select a repository & environment to save the tenant and subscription to GitHub.", {
    exact: true,
  });
  await expect
    .poll(async () => (await createBranchButton.isVisible()) || (await selectEnvironmentMessage.count()) === 0, {
      timeout: 30_000,
      message: `${environmentName} branch state did not finish loading`,
    })
    .toBeTruthy();
  if (await createBranchButton.isVisible()) {
    await createBranchButton.click();
    await expect(createBranchButton).toBeHidden({ timeout: 30_000 });
  }

  await expect(selectEnvironmentMessage).toHaveCount(0);
  await expect(azureSubscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
  const subscriptionSelect = azureSubscriptionCard.getByRole("combobox");
  await expectVisibleWithin(subscriptionSelect, "Azure subscription selector", 50_000);

  // a prior run may have saved a tenant/subscription that no longer restores automatically
  if (expectSavedVariables) {
    await subscriptionSelect.click();
    const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
    await expectVisibleWithin(subscriptionOption, `Subscription ${SUBSCRIPTION_ID} option`, 50_000);
    await subscriptionOption.click();
    // Defocus the select so it doesn't render a focus ring in any upcoming snapshot.
    await azureSubscriptionCard.getByText(/Pick the subscription to deploy into\./i).click();

    const saveVariablesButton = azureSubscriptionCard.getByRole("button", { name: /^Save(?: \d+)? variables?$/ });
    if (await saveVariablesButton.isEnabled().catch(() => false)) {
      console.log("Detected drift between the currently selected tenant/subscription and the saved GitHub variables — re-saving.");
      await saveVariablesButton.click();
      await expect(azureSubscriptionCard.getByRole("button", { name: "Save variables" })).toBeDisabled({ timeout: 60_000 });
    }
  }

  const tenantVariableInput = azureSubscriptionCard.getByText("AZURE_TENANT_ID", { exact: true }).locator("..").locator("..").getByRole("textbox");
  const subscriptionVariableInput = azureSubscriptionCard.getByText("AZURE_SUBSCRIPTION_ID", { exact: true }).locator("..").locator("..").getByRole("textbox");
  const saveButton = azureSubscriptionCard.getByRole("button", { name: "Save variables" });
  await expect.poll(async () => (await tenantVariableInput.inputValue()).trim(), { timeout: 60_000 }).not.toBe("");
  await expect.poll(async () => (await subscriptionVariableInput.inputValue()).trim(), { timeout: 60_000 }).not.toBe("");
  if (expectSavedVariables) {
    await expect(saveButton).toBeDisabled({ timeout: 60_000 });
  } else {
    await expectVisibleWithin(azureSubscriptionCard.getByText("2 not configured", { exact: true }), "Unconfigured variables status", 50_000);
  }

  return { azureSubscriptionCard, tenantVariableInput, subscriptionVariableInput, saveButton };
}

for (const [viewportName, viewport] of Object.entries(viewports)) {
  test.describe(`Azure Subscription Card - ${viewportName}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 });
    // The happy path is the main scenario for this card, showing the expect standard use case.
    test("Happy path", async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      const repoName = safePathSegment(`${TEST_REPO_MAIN}-${viewportName}`);
      await restoreGithubSessionStorage(context);
      await restoreAzureSessionStorage(context);
      await page.goto(CORP_URL);

      const azureCard = await test.step("Expand Azure Login Card", async () => {
        const azureCard = await expandAzureLoginCard(page);
        return azureCard;
      });

      const azureSubscriptionCard = await test.step("Expand Azure Subscription Card", async () => {
        const azureSubscriptionCard = await expandAzureSubscriptionCard(page);
        await expectSnapshot(page, azureSubscriptionCard, testInfo, "start", viewportName);
        return azureSubscriptionCard;
      });

      await test.step("Select tenant", async () => {
        const signedInText = azureCard.getByText(/Signed in as/i);
        const tenantSelect = azureCard.getByTestId("tenant-select");
        await expectVisibleWithin(signedInText, "Azure signed-in status", 50_000);
        await expectVisibleWithin(tenantSelect, "Azure tenant selector", 50_000);
        const tenantId = (await tenantSelect.locator("input").inputValue()).trim();
        expect(tenantId, "The restored Azure tenant ID should not be empty").not.toBe("");
        await tenantSelect.click();
        await page.getByRole("option").filter({ hasText: tenantId }).click();
        await expect(azureSubscriptionCard.getByText("Select a tenant", { exact: true })).toHaveCount(0);

        await expectSnapshot(page, azureSubscriptionCard, testInfo, "tenant-selected", viewportName);
      });

      const repoCard = await test.step("Expand the Repo Detail Card", async () => {
        const repoCard = await expandRepoCard(page);
        return repoCard;
      });

      await test.step("Create the repository if it does not exist", async (step) => {
        const repoExists = await checkRepoExists(page, repoCard, repoName);
        if (repoExists) {
          console.log(`Repository "${repoName}" already exists; skipping creation.`);
          step.skip(repoExists, `Repository "${repoName}" already exists; skipping creation.`);
        }
        await createNewRepo(page, repoCard, repoName);
      });

      await test.step("Select the existing repository", async (step) => {
        await chooseExistingRepo(page, repoCard, repoName);
      });

      await test.step("Select the PROD environment", async () => {
        const card = repoCard;
        await expect(card.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
        const prodEnvironment = card.getByText("PROD", { exact: true });
        await prodEnvironment.click();
        const createProdButton = card.getByRole("button", { name: "Create New Branch: PROD" });
        if (await createProdButton.isVisible()) {
          await createProdButton.click();
          await expect(createProdButton).toBeHidden({ timeout: 30_000 });
        }
      });

      await test.step("Saving prefilled Azure subscription variables", async () => {
        await expectVisibleWithin(azureSubscriptionCard.getByText(/Pick the subscription to deploy into\./i), "Subscription card prompt", 50_000);
        await expectVisibleWithin(azureSubscriptionCard.getByText(/^Tenant:/i), "Text: Rendering Tenant", 50000);
        await expectVisibleWithin(azureSubscriptionCard.getByRole("button", { name: "Change on Azure login" }), "Button: Change on Azure Login", 5000);
        await expectVisibleWithin(azureSubscriptionCard.getByText(/^Subscription/i), "Text: Rendering Subscription text", 50000);
        await expect(azureSubscriptionCard.getByText("Loading subscriptions...")).toBeHidden({ timeout: 60_000 });
        const subscriptionSelect = azureSubscriptionCard.getByRole("combobox");
        const noSubscriptionsMessage = azureSubscriptionCard.getByText("This tenant has no subscriptions you can access.", { exact: true });
        await expectVisibleWithin(subscriptionSelect.or(noSubscriptionsMessage), "Subscription selector or empty-state message", 50_000);

        if (await subscriptionSelect.isVisible()) {
          console.log(`Selecting subscription "${SUBSCRIPTION_ID}" automatically.`);
          await subscriptionSelect.click();
          const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
          await expectVisibleWithin(subscriptionOption, `Subscription ${SUBSCRIPTION_ID} option`, 50_000);
          await subscriptionOption.click();
          // Defocus the select so it doesn't render a focus ring in the upcoming snapshot.
          await azureSubscriptionCard.getByText(/Pick the subscription to deploy into\./i).click();
        }

        await expect(
          azureSubscriptionCard.getByText("Select a repository & environment to save the tenant and subscription to GitHub.", { exact: true })
        ).toHaveCount(0);
        const saveButton = azureSubscriptionCard.getByRole("button", { name: /^Save(?: 2)? variables$/ });
        if ((await saveButton.count()) > 0 && (await saveButton.isEnabled({ timeout: 0 }))) {
          await saveButton.click();
          await expect(azureSubscriptionCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled({ timeout: 60_000 });
          await expectSnapshot(page, azureSubscriptionCard, testInfo, "subscription-saved", viewportName);
        }
        await expectSnapshot(page, azureSubscriptionCard, testInfo, "end", viewportName);
      });
    });

    test("Selecting an existing repository with environment variables already saved", async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      const { azureSubscriptionCard, tenantVariableInput, subscriptionVariableInput, saveButton } = await openExistingAzureSubscription(
        page,
        context,
        viewportName
      );

      await expect(tenantVariableInput).not.toHaveValue("");
      await expect(subscriptionVariableInput).not.toHaveValue("");
      await expect(azureSubscriptionCard.getByText("Unsaved change — save to apply.", { exact: true })).toHaveCount(0);
      await expect(saveButton).toBeDisabled();

      await expectSnapshot(page, azureSubscriptionCard, testInfo, "edge-case-existing-repo", viewportName);
    });

    test("Modifying one existing prefilled variable", async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      const { azureSubscriptionCard, subscriptionVariableInput, saveButton } = await openExistingAzureSubscription(page, context, viewportName);
      const savedSubscriptionId = await subscriptionVariableInput.inputValue();

      await subscriptionVariableInput.fill(`${savedSubscriptionId}-modified`);
      const saveOneVariableButton = azureSubscriptionCard.getByRole("button", { name: "Save 1 variable" });
      await expect(saveOneVariableButton).toBeEnabled();
      await expectVisibleWithin(azureSubscriptionCard.getByText("overwrites", { exact: true }), "Variable overwrite warning", 50_000);

      await azureSubscriptionCard.getByRole("button", { name: "Revert to saved value" }).click();
      await expect(subscriptionVariableInput).toHaveValue(savedSubscriptionId);
      await expect(azureSubscriptionCard.getByText("overwrites", { exact: true })).toHaveCount(0);
      await expect(saveButton).toBeDisabled();
      await expectSnapshot(page, azureSubscriptionCard, testInfo, "edge-case-variable-modified", viewportName);
    });

    test("Modifying all existing prefilled variables", async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      const { azureSubscriptionCard, tenantVariableInput, subscriptionVariableInput, saveButton } = await openExistingAzureSubscription(
        page,
        context,
        viewportName
      );
      const savedTenantId = await tenantVariableInput.inputValue();
      const savedSubscriptionId = await subscriptionVariableInput.inputValue();
      const tenantVariableRow = azureSubscriptionCard.getByText("AZURE_TENANT_ID", { exact: true }).locator("..").locator("..");
      const subscriptionVariableRow = azureSubscriptionCard.getByText("AZURE_SUBSCRIPTION_ID", { exact: true }).locator("..").locator("..");

      await tenantVariableInput.fill("modified");
      await subscriptionVariableInput.fill("modified");
      const saveTwoVariablesButton = azureSubscriptionCard.getByRole("button", { name: "Save 2 variables" });
      await expect(saveTwoVariablesButton).toBeEnabled();
      await expect(azureSubscriptionCard.getByText("overwrites", { exact: true })).toHaveCount(2);

      const subscriptionSelect = azureSubscriptionCard.getByRole("combobox");

      await tenantVariableRow.getByRole("button", { name: "Revert to saved value" }).click();
      await subscriptionVariableRow.getByRole("button", { name: "Revert to saved value" }).click();
      await expect(tenantVariableInput).toHaveValue(savedTenantId);
      await expect(subscriptionVariableInput).toHaveValue(savedSubscriptionId);
      await expect(azureSubscriptionCard.getByText("overwrites", { exact: true })).toHaveCount(0);
      await expect(saveButton).toBeDisabled();
      await expectSnapshot(page, azureSubscriptionCard, testInfo, "edge-case-both-variables-modified", viewportName);
    });

    test("Both prefilled variables are removed before saving", async ({ page, context }, testInfo) => {
      test.setTimeout(300_000);
      const { azureSubscriptionCard, tenantVariableInput, subscriptionVariableInput } = await openExistingAzureSubscription(page, context, viewportName);
      const savedTenantId = await tenantVariableInput.inputValue();
      const savedSubscriptionId = await subscriptionVariableInput.inputValue();

      try {
        await tenantVariableInput.fill("");
        await subscriptionVariableInput.fill("");
        const removeVariablesButton = azureSubscriptionCard.getByRole("button", { name: "Save 2 variables", exact: true });
        await expect(removeVariablesButton).toBeEnabled();
        await expect(azureSubscriptionCard.getByText("overwrites", { exact: true })).toHaveCount(2);
        await removeVariablesButton.click();

        await expect(tenantVariableInput).toHaveValue("");
        await expect(subscriptionVariableInput).toHaveValue("");
        await expectVisibleWithin(azureSubscriptionCard.getByText("2 not configured", { exact: true }), "Unconfigured variables status", 50_000);

        const subscriptionSelect = azureSubscriptionCard.getByRole("combobox");
        await expectSnapshot(page, azureSubscriptionCard, testInfo, `edge-case-both-variables-removed`, viewportName);
      } finally {
        await tenantVariableInput.fill(savedTenantId);
        await subscriptionVariableInput.fill(savedSubscriptionId);
        const restoreVariablesButton = azureSubscriptionCard.getByRole("button", { name: "Save 2 variables", exact: true });
        if (await restoreVariablesButton.isEnabled()) {
          await restoreVariablesButton.click();
        }
        await expect(tenantVariableInput).toHaveValue(savedTenantId);
        await expect(subscriptionVariableInput).toHaveValue(savedSubscriptionId);
        await expect(azureSubscriptionCard.getByText("2 not configured", { exact: true })).toHaveCount(0, { timeout: 60_000 });
        await expect(azureSubscriptionCard.getByRole("button", { name: "Save variables", exact: true })).toBeDisabled({ timeout: 60_000 });
      }
    });
  });
}
