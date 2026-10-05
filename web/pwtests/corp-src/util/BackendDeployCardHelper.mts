/// <reference types="node" />
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { CORP_URL, TEST_REPO_MAIN } from "../../testInit";
import { expandAzureLoginCard, expandRepoCard } from "./cardHelper.mts";
import { chooseExistingRepo } from "./testHelper.mts";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "./setupHelper.mts";

export async function openBackendCard(page: Page) {
	const card = page.locator("#card-backend_deploy");
	await expect(card).toBeVisible();
	if (await card.locator('svg[data-testid="ExpandMoreIcon"]').count()) {
		await card.getByText("Private Zeninstaller Backend", { exact: true }).click();
	}
	await expect(card.getByText(/Builds the Zeninstaller backend in GitHub Actions/)).toBeVisible({ timeout: 60_000 });
	await expect(card.getByText(/checking\.\.\./)).toHaveCount(0, { timeout: 60_000 });
	return card;
}

export function backendStepLabels(appName: string) {
	return ["Download the built package", `Upload it to ${appName}`, "Wait for the Function App to unpack it"];
}

export async function prepareExistingBackend(page: Page, context: BrowserContext, viewportName: string) {
	await restoreGithubSessionStorage(context);
	await restoreAzureSessionStorage(context);
	await page.goto(CORP_URL);
	const azureCard = await expandAzureLoginCard(page);
	const tenantSelect = azureCard.getByTestId("tenant-select");
	await expect(tenantSelect).toBeVisible({ timeout: 60_000 });
	const tenantId = (await tenantSelect.locator("input").inputValue()).trim();
	expect(tenantId).not.toBe("");
	await tenantSelect.click();
	await page.getByRole("option").filter({ hasText: tenantId }).click();
	const repoName = `${TEST_REPO_MAIN}-${viewportName}`;
	const repoCard = await expandRepoCard(page);
	await chooseExistingRepo(page, repoCard, repoName);
	await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden({ timeout: 120_000 });
	await repoCard.getByText("PROD", { exact: true }).click();

	// Read existing configuration only; no repository, variable, or infrastructure writes.
	const variables = await page.evaluate(async ({ repoName }) => {
		const auth = JSON.parse(sessionStorage.getItem("zeninstaller_github_auth") ?? "null");
		if (auth?.mode !== "direct" || !auth.token) throw new Error("This integration test requires existing GitHub PAT session state.");
		const headers = { Authorization: `Bearer ${auth.token}`, Accept: "application/vnd.github+json" };
		const userResponse = await fetch("https://api.github.com/user", { headers });
		if (!userResponse.ok) throw new Error(`Reading GitHub identity failed: ${userResponse.status}`);
		const user = await userResponse.json();
		const entries: { name: string; value: string }[] = [];
		for (let page = 1; ; page++) {
			const response = await fetch(`https://api.github.com/repos/${user.login}/${repoName}/environments/PROD/variables?per_page=100&page=${page}`, { headers });
			if (!response.ok) throw new Error(`Reading existing PROD variables failed: ${response.status}`);
			const data = await response.json() as { variables: { name: string; value: string }[] };
			entries.push(...data.variables);
			if (data.variables.length < 100) break;
		}
		return Object.fromEntries(entries.map(({ name, value }) => [name, value]));
	}, { repoName });
	for (const key of ["NAME", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "WEBPUBSUB_ENDPOINT",
		"WEBPUBSUB_CLIENT_ID", "WEBPUBSUB_TENANT_ID", "BACKEND_API"]) {
		expect(variables[key], `Existing PROD variable ${key} is required; run the prerequisite card separately`).toBeTruthy();
	}
	expect(variables.AZURE_TENANT_ID, "Use the tenant already saved in PROD").toBe(tenantId);
	expect(variables.BACKEND_API).toBe(`https://${variables.NAME}-terminal-app.azurewebsites.net`);
	await page.evaluate((values) => {
		localStorage.setItem("zeninstaller_remote_terminal_infra_result", JSON.stringify({
			corpName: values.NAME, subscriptionId: values.AZURE_SUBSCRIPTION_ID,
			apiUrl: values.BACKEND_API, webPubSubHost: values.WEBPUBSUB_ENDPOINT, hubName: "terminal",
			pipelineClientId: values.WEBPUBSUB_CLIENT_ID, pipelineTenantId: values.WEBPUBSUB_TENANT_ID,
		}));
	}, variables);
	await page.reload();
	return { card: await openBackendCard(page), appName: `${variables.NAME}-terminal-app`, variables };
}
