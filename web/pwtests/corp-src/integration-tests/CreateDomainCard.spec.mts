/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// UI component: ../../../corp-src/cards/CreateDomainCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN, TEST_DNS_DOMAIN, viewports } from "../../testInit";
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
	await expect(subscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
	await expectVisibleWithin(subscriptionCard.getByRole("combobox"), "Azure subscription selector", 50_000);
	const subscriptionSelect = subscriptionCard.getByRole("combobox");
	await subscriptionSelect.click();
	const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
	await expectVisibleWithin(subscriptionOption, `Subscription ${SUBSCRIPTION_ID} option`, 50_000);
	await subscriptionOption.click();

	await expect(subscriptionCard.getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
	const pendingSave = subscriptionCard.getByRole("button", { name: /^Save\s+[12]\s+variables?$/ });
	const cleanSave = subscriptionCard.getByRole("button", { name: /^Save\s+variables$/ });
	await expect(subscriptionCard.getByRole("button", { name: /^Save\s+(?:[12]\s+)?variables?$/ })).toBeVisible({ timeout: 60_000 });
	if (await pendingSave.count()) {
		await pendingSave.click();
	}
	await expect(cleanSave).toBeDisabled({ timeout: 60_000 });

	//TODO: check what happens if registration name left blank (catch error)
	const appRegistrationCard = await expandAzureAppRegistrationCard(page);
	const coreInfraCard = page.locator("#card-core_infra");
	await coreInfraCard.getByText("Terraform state backend", { exact: true }).click();
	const appRegistrationRequirement = coreInfraCard.getByText("Complete the Azure app registration", { exact: true });
	const connectionInputs = appRegistrationCard.locator('[data-sensitive="true"] input');
	await expect(connectionInputs).toHaveCount(2, { timeout: 50_000 });
	await expect.poll(async () =>
		!(await appRegistrationRequirement.isVisible()) ||
		await appRegistrationCard.getByText(/\d+ not configured|doesn't exist in the selected tenant|Missing on the selected subscription|doesn't match AZURE_CLIENT_ID/i).count() > 0,
	{ timeout: 60_000 }).toBe(true);
	if (await appRegistrationRequirement.isVisible()) {
		const appNameInput = appRegistrationCard.locator("input:visible").first();
		await expectVisibleWithin(appNameInput, "App registration name input", 50_000);
		await appNameInput.fill(safePathSegment(`zeninstaller-${repoName}-${Date.now().toString(36)}`));
		await appRegistrationCard.getByRole("button", { name: /^(?:Create app registration|Grant access on this subscription)$/ }).click();
		await expectVisibleWithin(appRegistrationCard.getByRole("button", { name: "Try again" }), "App registration completion", 300_000);
		await expectVisibleWithin(
			appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i),
			"Saved app registration connection details",
			60_000,
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
  test.describe(`Create Domain Card - ${viewportName}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 });

		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(1_200_000);

			await test.step("Prepare the selected Azure subscription", async () => {
				await prepareExistingAzureSubscription(page, context, viewportName);
			});

			await test.step("Ensure the Terraform state backend is configured", async () => {
				const terraformCard = page.locator("#card-core_infra");
				await expectVisibleWithin(terraformCard.getByText("Company short code"), "Company short code field", 50_000);
				await expect(terraformCard.getByRole("progressbar")).toBeHidden({ timeout: 60_000 });
				const companyInput = terraformCard
					.getByText("COMPANY_SHORT_CODE", { exact: true })
					.locator("../..")
					.getByRole("textbox");
				await expectVisibleWithin(companyInput, "Company short code input", 50_000);
				if (!(await companyInput.inputValue()).trim()) {
					await companyInput.fill("pwtests");
				}
				const companyShortCode = (await companyInput.inputValue()).trim();
				const saveButton = terraformCard.getByRole("button", { name: /^Save\s+(?:\d+\s+)?variables?$/ });
				await expect(saveButton).toBeVisible();
				if (await saveButton.isEnabled()) {
					await saveButton.click();
				}
				await expect(terraformCard.getByRole("button", { name: /^Save\s+variables?$/ })).toBeDisabled({ timeout: 60_000 });

				// Re-run even a completed backend: its cached status does not check the state container.
				const setupButton = terraformCard.getByRole("button", { name: /^(?:Create core infrastructure|Re-run setup)$/ });
				await expectVisibleWithin(setupButton, "Terraform backend setup button", 50_000);
				await expect(setupButton).toBeEnabled({ timeout: 60_000 });
				await setupButton.click();
				await expectVisibleWithin(terraformCard.getByRole("button", { name: "Start over" }), "Terraform backend setup completion", 500_000);
				await expectSuccessfulSteps(terraformCard, coreInfraStepLabels(companyShortCode));
				await expect(terraformCard.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
				await expect(terraformCard.locator('svg[data-testid="ErrorOutlineIcon"]')).toHaveCount(0);
			});

			const card = page.locator("#card-create_domain");
			await test.step("Open the Corp domain card", async () => {
				await expect(card.getByText("Set up Corp infrastructure", { exact: true })).toBeHidden({ timeout: 60_000 });
				await card.click();
				const introText = card.getByText(/Set up the corp domain\./i);
				if (!(await introText.isVisible())) {await card.getByText('Core domain').nth(1).click();}
				await expectVisibleWithin(card.getByText(/Creates the DNS zone for/i), "Domain setup description", 50_000);
			});
            
			await test.step("Save variables then set up corp domain", async (step) => {
				const domainInput = card.getByText("DNS DOMAIN").locator("../..").getByRole("textbox");
				await expectVisibleWithin(domainInput, "Corp domain input", 50_000);
				await expect(card.getByRole("progressbar")).toBeHidden({ timeout: 60_000 });
				const rerunButton = card.getByRole("button", { name: "Re-run setup" });
				if ((await domainInput.inputValue()).trim() === TEST_DNS_DOMAIN && await rerunButton.isVisible()) {
					await expect(card.getByRole("button", { name: /^Save variables$/ })).toBeDisabled();
					console.log("Corp domain is already configured.");
					step.skip(true, "Corp domain is already configured.");
				}

				if ((await domainInput.inputValue()).trim() !== TEST_DNS_DOMAIN) {
					await expectSnapshot(page, card, testInfo, "start", viewportName);
					await domainInput.fill(TEST_DNS_DOMAIN);
					const saveButton = card.getByRole("button", { name: "Save 1 variable" });
					await saveButton.click();
					await expect(card.getByRole("button", { name: "Save variable" })).toBeDisabled({ timeout: 60_000 });
				}

				await expect(domainInput).toHaveValue(TEST_DNS_DOMAIN);
				const setupButton = card.getByRole("button", { name: "Set up core DNS domain" });
				
				if (await rerunButton.isVisible({ timeout: 60_000 })) {
					console.log("Corp domain is already configured.");
					step.skip(true, "Corp domain is already configured.");
				}

				if (await setupButton.isVisible({ timeout: 60_000 })) {
					await card.getByRole("button", { name: "Set up core DNS domain" }).click();
				}
				
				await expectVisibleWithin(card.getByRole("button", { name: "Start over" }), "Domain setup completion", 500_000);
				await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
				await expectSnapshot(page, card, testInfo, "new-setup", viewportName);
				await page.waitForTimeout(2000); // frontend completes before actual API
			});

			
			await test.step("Reuse the existing Corp domain", async () => {
				await page.reload();
				if (!(await card.getByText(/Creates the DNS zone for/i).isVisible())) {
					await card.getByText("Corp domain", { exact: true }).first().click();
				}

				//TODO: if you reload the page for existing domain then Set up Core DNS Domain button reappears
				const setupButton = card.getByRole("button", { name: "Re-run setup" });
				await expectVisibleWithin(setupButton, "Corp domain setup button", 50_000);
				await setupButton.click();
				await expectVisibleWithin(card.getByRole("button", { name: "Start over" }), "Domain re-run completion", 500_000);

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
				await expectSnapshot(page, card, testInfo, "existing-setup", viewportName);
				await page.reload();
				if (!(await card.getByText(/Creates the DNS zone for/i).isVisible())) {
					await card.getByText("Corp domain", { exact: true }).first().click();
				}
			});

			await test.step("Verify the domain card completion state", async () => {
				await expectVisibleWithin(card.getByText("Resources", { exact: true }), "Domain resources section", 50_000);
				await expectVisibleWithin(card.getByText(/DNS zone:/i), "DNS zone details", 50_000);
				await expectSnapshot(page, card, testInfo, "end", viewportName);
			});
		});

	});
}
