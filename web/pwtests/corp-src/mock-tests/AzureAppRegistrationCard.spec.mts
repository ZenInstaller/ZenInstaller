// UI component: ../../../corp-src/cards/AzureAppRegistrationCard.tsx
import { expect, test } from "@playwright/test";
import { CORP_URL, GITHUB_API_URL, viewports } from "../../testInit";
import { createNewRepo } from "../util/testHelper.mts";
import { expectSnapshot, safePathSegment } from "../../util/testHelper.ts";
import { installMockAzure, installMockGitHub, prepareMockAzureSubscription, signInMockAzure } from "../util/mockTestHelper.mts";
import { expandAzureAppRegistrationCard, expandAzureLoginCard, expandAzureSubscriptionCard, expandRepoCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

async function prepareMockAppRegistrationCard(	page: import("@playwright/test").Page,	context: import("@playwright/test").BrowserContext,	repoName: string,) {
	const prepared = await prepareMockAzureSubscription(page, context, repoName, { saveVariables: true });
	return {
		...prepared,
		appRegistrationCard: await expandAzureAppRegistrationCard(page),
	};
}

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Azure App Registration Card Mock - ${viewportName}`, () => {
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

		test("Happy path", async ({ page, context }, testInfo) => {
			const runId = Date.now().toString(36);
			const repoName = safePathSegment(`mock-azure-app-${viewportName.toLowerCase()}`);
			const appName = `zeninstaller-${repoName}`;
			await installMockGitHub(page, context);
			await installMockAzure(page);
			await page.goto(CORP_URL);

			const azureLoginCard = await test.step("Select the restored Azure tenant", async () => {
				const card = await expandAzureLoginCard(page);
				await expectSnapshot(page, card, testInfo, "start", viewportName);
				await signInMockAzure(page);
				await expect(card.getByText(/Signed in as/i)).toBeVisible();
				const tenantSelect = card.getByTestId("tenant-select");
				await expect(tenantSelect).toBeVisible();
				await tenantSelect.click();
				await page.getByRole("option", { name: /Mock tenant/i }).click();
				await expectSnapshot(page, card, testInfo, "tenant-selected", viewportName);
				return card;
			});

			const repoCard = await test.step("Create a repository and PROD environment", async () => {
				const card = await expandRepoCard(page);
				await createNewRepo(page, card, repoName);
				await expect(card.getByText("Loading environments...", { exact: true })).toBeHidden();
				const prodEnvironment = card.getByText("PROD", { exact: true });
				await expect(prodEnvironment).toBeVisible();
				await prodEnvironment.click();
				const createProdButton = card.getByRole("button", { name: "Create New Branch: PROD" });
				if (await createProdButton.isVisible()) {
					await createProdButton.click();
					await expect(createProdButton).toBeHidden();
				}
				await expectSnapshot(page, card, testInfo, "repo-created", viewportName);
				return card;
			});

			await test.step("Save the Azure subscription variables", async () => {
				const card = await expandAzureSubscriptionCard(page);
				await expect(card.getByText("Loading subscriptions...", { exact: true })).toBeHidden();
				await expect(card.getByRole("combobox")).toBeVisible();
				await card.getByRole("button", { name: "Save 2 variables" }).click();
				await expect(card.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled();
				await expectSnapshot(page, card, testInfo, "subscription-saved", viewportName);
			});

			const appRegistrationCard = await test.step("Expand app registration card", async () => {
				return await expandAzureAppRegistrationCard(page);
			});

			await test.step("Create new app registration and grant access", async () => {
				const appNameInput = appRegistrationCard.locator("input:visible").first();
				await expect(appNameInput).toBeVisible();
				await appNameInput.fill(appName);
				await expectSnapshot(page, appRegistrationCard, testInfo, "app-prefilled", viewportName);
				await appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
				await expect(appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
				await expect(appRegistrationCard.getByRole("button", { name: "Try again" })).toBeVisible();
				for (const stepLabel of [
					"Confirm Microsoft permissions",
					"Create app registration",
					"Create service principal",
					"Switch GitHub OIDC to immutable subject",
					"Add federated credentials",
					"Assign RBAC roles",
				]) {
					await expect(appRegistrationCard.getByText(stepLabel, { exact: true })).toBeVisible();
				}
				await expect(appRegistrationCard.getByText(/Additional consent required|Consent redirect failed/i)).toHaveCount(0);
				await expectSnapshot(page, appRegistrationCard, testInfo, "app-created", viewportName);
			});

			await test.step("Verify connection details were auto-saved", async () => {
				await expect(
					appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i),
				).toBeVisible();
				const connectionInputs = appRegistrationCard.locator('[data-sensitive="true"] input');
				await expect(connectionInputs).toHaveCount(2);
				const clientIds = await connectionInputs.evaluateAll((inputs) =>
					inputs.map((input) => (input as HTMLInputElement).value.trim()),
				);
				expect(clientIds[0], "AZURE_CLIENT_ID should be populated").not.toBe("");
				expect(clientIds[1], "AZURE_PLAN_CLIENT_ID should be populated").toBe(clientIds[0]);
				await expect(appRegistrationCard.getByText("2 not configured", { exact: true })).toHaveCount(0);
				await expectSnapshot(page, appRegistrationCard, testInfo, "end", viewportName);
			});

			await expect(azureLoginCard.getByText(/Signed in as/i)).toBeVisible();
			await expect(repoCard.getByText("PROD", { exact: true })).toBeVisible();
		});

		test("Edge case - keeps creation disabled for a blank app name", async ({ page, context }, testInfo) => {
			const runId = Date.now().toString(36);
			const prepared = await prepareMockAppRegistrationCard(
				page,
				context,
				`mock-app-blank-${viewportName.toLowerCase()}`,
			);
			const appNameInput = prepared.appRegistrationCard.locator("input:visible").first();
			const createButton = prepared.appRegistrationCard.getByRole("button", { name: "Create app registration" });
			await appNameInput.fill("   ");
			await expect(createButton).toBeDisabled();
			await appNameInput.fill(`valid-app-${runId}`);
			await expect(createButton).toBeEnabled();
			await expectSnapshot(
				page,
				prepared.appRegistrationCard,
				testInfo,
				"blank-app-name",
				viewportName,
			);
		});

		test("Edge case - reuses an existing app registration on retry", async ({ page, context }, testInfo) => {
			const prepared = await prepareMockAppRegistrationCard(
				page,
				context,
				`mock-app-retry-${viewportName.toLowerCase()}`,
			);
			const appNameInput = prepared.appRegistrationCard.locator("input:visible").first();
			await appNameInput.fill("zeninstaller-existing-mock-app");
			await prepared.appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
			await expect(prepared.appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
			await expect(prepared.appRegistrationCard.getByRole("button", { name: "Try again" })).toBeVisible();

			await prepared.appRegistrationCard.getByRole("button", { name: "Try again" }).click();
			await expect(appNameInput).toBeVisible();
			await prepared.appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
			await expect(prepared.appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
			await expect(prepared.appRegistrationCard.getByText(/Existing:/i)).toBeVisible();
			await expect(prepared.appRegistrationCard.getByText("Already exists", { exact: true })).toBeVisible();
			await expect(
				prepared.appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i),
			).toBeVisible();
			await expectSnapshot(
				page,
				prepared.appRegistrationCard,
				testInfo,
				"existing-app-reused",
				viewportName,
			);
		});

		test("Edge case - warns when the saved app registration is missing", async ({ page, context }, testInfo) => {
			await context.addInitScript(() => {
				localStorage.setItem(
					"zeninstaller_azure_result",
					JSON.stringify({ clientId: "mock-app-id", tenantId: "00000000-0000-0000-0000-000000000001", subscriptionIds: ["mock-subscription"] }),
				);
			});
			await prepareMockAzureSubscription(page, context, `mock-app-missing-sp-${viewportName.toLowerCase()}`, {
				initialVariables: {
					AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000001",
					AZURE_SUBSCRIPTION_ID: "mock-subscription",
					AZURE_CLIENT_ID: "mock-app-id",
					AZURE_PLAN_CLIENT_ID: "mock-app-id",
				},
			});
			const card = await expandAzureAppRegistrationCard(page);

			await expect(
				card.getByText("This app registration doesn't exist in the selected tenant — create a new one.", { exact: true }),
			).toBeVisible();
			await expect(card.locator('svg[data-testid="ErrorOutlineIcon"]')).toHaveCount(2);
			await expectSnapshot(page, card, testInfo, "saved-app-missing", viewportName);
		});

		test("Edge case - warns when the saved app registration has no subscription role", async ({ page, context }, testInfo) => {
			await context.addInitScript(() => {
				localStorage.setItem(
					"zeninstaller_azure_result",
					JSON.stringify({ clientId: "mock-app-id", tenantId: "00000000-0000-0000-0000-000000000001", subscriptionIds: ["mock-subscription"] }),
				);
			});
			const prepared = await prepareMockAzureSubscription(
				page,
				context,
				`mock-app-missing-role-${viewportName.toLowerCase()}`,
				{
					initialVariables: {
						AZURE_TENANT_ID: "00000000-0000-0000-0000-000000000001",
						AZURE_SUBSCRIPTION_ID: "mock-subscription",
						AZURE_CLIENT_ID: "mock-app-id",
						AZURE_PLAN_CLIENT_ID: "mock-app-id",
					},
				},
			);
			prepared.azure.servicePrincipalCreated = true;
			await page.reload();
			const card = await expandAzureAppRegistrationCard(page);

			await expect(card.getByText(/Missing on the selected subscription:/)).toContainText("Reader");
			await expect(card.getByRole("button", { name: "Grant access on this subscription" })).toBeVisible();
			await expectSnapshot(page, card, testInfo, "saved-app-role-missing", viewportName);
		});

		test("Edge case - reports when connection details fail to auto-save", async ({ page, context }, testInfo) => {
			const prepared = await prepareMockAppRegistrationCard(
				page,
				context,
				`mock-app-autosave-error-${viewportName.toLowerCase()}`,
			);
			let failedWrites = 0;
			await page.route(`${GITHUB_API_URL}/repos/**/environments/PROD/variables`, async (route) => {
				if (route.request().method() !== "POST") {
					await route.fallback();
					return;
				}
				failedWrites += 1;
				await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "mock failure" }) });
			});
			const appNameInput = prepared.appRegistrationCard.locator("input:visible").first();
			await appNameInput.fill(`mock-autosave-${viewportName.toLowerCase()}`);
			await prepared.appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
			await expect(prepared.appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
			await expect(
				prepared.appRegistrationCard.getByText("Some connection details failed to save — check below.", { exact: true }),
			).toBeVisible();
			expect(failedWrites).toBe(2);
			await expectSnapshot(page, prepared.appRegistrationCard, testInfo, "connection-details-save-failed", viewportName);
		});
	});
}
