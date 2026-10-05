import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN } from "../../testInit";
import { safePathSegment } from "../../util/testHelper.ts";
import {
	expandAzureAppRegistrationCard,
	expandAzureLoginCard,
	expandAzureSubscriptionCard,
	expandRepoCard,
} from "./cardHelper.mts";
import { chooseExistingRepo } from "./testHelper.mts";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "./setupHelper.mts";
import { coreInfraStepLabels, expectSuccessfulSteps } from "./mockTestHelper.mts";

export async function openRemoteTerminalCard(page: Page) {
	const card = page.locator("#card-remote_terminal_infra");
	const description = card.getByText(/The relay behind the stage-card terminal:/);
	if (await card.locator('svg[data-testid="ExpandMoreIcon"]').count()) {
		await card.getByText("Private Zeninstaller Environment", { exact: true }).click();
	}
	await expect(description).toBeVisible({ timeout: 60_000 });
	return card;
}

export function connectionInput(card: Locator, key: string) {
	return card.getByText(key, { exact: true }).locator("../..").getByRole("textbox");
}

export async function openConnectionDetails(card: Locator) {
	const toggle = card.getByText("open to enter connection detail", { exact: true });
	if (await toggle.isVisible()) await toggle.click();
	await expect(card.getByText("Connection details", { exact: true })).toBeVisible();
	await expect(card.getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
}

export function remoteTerminalStepLabels(corpName: string) {
	return [
		"Register required Azure resource providers",
		`Create resource group root-${corpName}`,
		`Create Log Analytics workspace ${corpName}-terminal-law`,
		`Create Application Insights ${corpName}-terminal-ai`,
		`Create storage account ${corpName.toLowerCase()}term`,
		"Create sessions table",
		"Create deployment container",
		`Create Web PubSub ${corpName}-wpubsub`,
		"Configure hub terminal",
		"Create Flex Consumption plan",
		`Create Function App ${corpName}-terminal-app`,
		"Grant the Function App its data-plane roles",
		`Create app registration ${corpName}-terminal-pipeline`,
		"Create its service principal",
		"Add GitHub OIDC credentials for PROD, TEST",
		"Grant it Web PubSub Service Owner",
	];
}

export async function prepareExistingRelayRepository(page: Page, context: BrowserContext, viewportName: string) {
	await restoreGithubSessionStorage(context);
	await restoreAzureSessionStorage(context);
	await page.goto(CORP_URL);
	const azureCard = await expandAzureLoginCard(page);
	const tenantSelect = azureCard.getByTestId("tenant-select");
	await expect(tenantSelect).toBeVisible({ timeout: 50_000 });
	const tenantId = (await tenantSelect.locator("input").inputValue()).trim();
	expect(tenantId, "A restored Azure tenant is required").not.toBe("");
	await tenantSelect.click();
	await page.getByRole("option").filter({ hasText: tenantId }).click();

	const repoName = safePathSegment(`${TEST_REPO_MAIN}-${viewportName}`);
	const repoCard = await expandRepoCard(page);
	// Never clone or create a repository for relay tests.
	await chooseExistingRepo(page, repoCard, repoName);
	await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
	await repoCard.getByText("PROD", { exact: true }).click();
	const subscriptionCard = await expandAzureSubscriptionCard(page);
	await expect(subscriptionCard.getByText(
		"Select a repository & environment to save the tenant and subscription to GitHub.", { exact: true },
	)).toHaveCount(0, { timeout: 60_000 });
	await expect(subscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
	await subscriptionCard.getByRole("combobox").click();
	await page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID }).click();
	await expect(subscriptionCard.getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
	const subscriptionSave = subscriptionCard.getByRole("button", { name: /^Save\s+(?:\d+\s+)?variables?$/ });
	await expect(subscriptionSave).toBeVisible();
	if (await subscriptionSave.isEnabled()) await subscriptionSave.click();
	await expect(subscriptionCard.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });

	const appCard = await expandAzureAppRegistrationCard(page);
	const coreCard = page.locator("#card-core_infra");
	await coreCard.getByText("Terraform state backend", { exact: true }).click();
	const requirement = coreCard.getByText("Complete the Azure app registration", { exact: true });
	await expect(appCard.locator('[data-sensitive="true"] input')).toHaveCount(2, { timeout: 60_000 });
	await expect.poll(async () =>
		!(await requirement.isVisible()) ||
		await appCard.getByText(/\d+ not configured|doesn't exist in the selected tenant|Missing on the selected subscription|doesn't match AZURE_CLIENT_ID/i).count() > 0,
	{ timeout: 60_000 }).toBe(true);
	if (await requirement.isVisible()) {
		await appCard.locator("input:visible").first().fill(`zeninstaller-${repoName}`);
		await appCard.getByRole("button", { name: /^(?:Create app registration|Grant access on this subscription)$/ }).click();
		await expect(appCard.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 300_000 });
		await expect(requirement).toBeHidden({ timeout: 60_000 });
	}
	const companyInput = connectionInput(coreCard, "COMPANY_SHORT_CODE");
	await expect(companyInput).toBeVisible({ timeout: 60_000 });
	await expect(coreCard.getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
	if (!(await companyInput.inputValue()).trim()) await companyInput.fill("pwtests");
	const corpName = (await companyInput.inputValue()).trim();
	const coreSave = coreCard.getByRole("button", { name: /^Save\s+(?:\d+\s+)?variables?$/ });
	if (await coreSave.isEnabled()) await coreSave.click();
	await expect(coreCard.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });
	const relayCard = page.locator("#card-remote_terminal_infra");
	await relayCard.getByText("Private Zeninstaller Environment", { exact: true }).click();
	const coreRequirement = relayCard.getByText("Set up Corp infrastructure", { exact: true });
	if (await coreRequirement.isVisible()) {
		await coreCard.getByRole("button", { name: /^(?:Create core infrastructure|Re-run setup)$/ }).click();
		await expect(coreCard.getByText("Running...", { exact: true })).toBeHidden({ timeout: 300_000 });
		await expectSuccessfulSteps(coreCard, coreInfraStepLabels(corpName));
	}
	await expect(relayCard.getByText(/The relay behind the stage-card terminal:/)).toBeVisible({ timeout: 60_000 });
	return { card: relayCard, corpName, tenantId, repoName };
}