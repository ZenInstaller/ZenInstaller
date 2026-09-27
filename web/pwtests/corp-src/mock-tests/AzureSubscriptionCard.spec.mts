// UI component: ../../../corp-src/cards/AzureSubscriptionCard.tsx
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { createNewRepo } from "../util/testHelper.mts";
import { expectSnapshot } from "../../util/testHelper.ts";
import { installMockAzure, installMockGitHub, mockSubscriptionId, prepareMockAzureSubscription, savedAzureVariables, signInMockAzure } from "../util/mockTestHelper.mts";
import { expandAzureLoginCard, expandAzureSubscriptionCard, expandRepoCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Azure Subscription Card Mock - ${viewportName}`, () => {
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
			await installMockGitHub(page, context);
			await installMockAzure(page);
			await page.goto(CORP_URL);

			const azureCard = await test.step("Expand Azure Login Card", async () => {
				const card = await expandAzureLoginCard(page);
				await signInMockAzure(page);
				await expect(card.getByText(/Signed in as/i)).toBeVisible();
				return card;
			});

			const azureSubscriptionCard = await test.step("Expand Azure Subscription Card", async () => {
				const card = await expandAzureSubscriptionCard(page);
				await expectSnapshot(page, card, testInfo, "start", viewportName);
				return card;
			});

			await test.step("Select tenant", async () => {
				const tenantSelect = azureCard.getByTestId("tenant-select");
				await expect(tenantSelect).toBeVisible();
				await tenantSelect.click();
				await page.getByRole("option", { name: /Mock tenant/i }).click();
				await expect(azureSubscriptionCard.getByText("Select a tenant", { exact: true })).toHaveCount(0);
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "tenant-selected", viewportName);
			});

			const repoCard = await test.step("Expand repo card", async () => {
				const card = await expandRepoCard(page);
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "repo-card-expanded", viewportName);
				return card;
			});

			await test.step("Clone repository", async () => {
				await createNewRepo(page, repoCard, `mock-azure-subscription-${viewportName.toLowerCase()}`);
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				const prodEnvironment = repoCard.getByText("PROD", { exact: true });
				await expect(prodEnvironment).toBeVisible();
				await prodEnvironment.click();
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "clone-repo", viewportName);
			});

			await test.step("Repo create environment", async () => {
				const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
				if (await createProdButton.isVisible()) {
					await createProdButton.click();
					await expect(createProdButton).toBeHidden();
				}
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "create-env", viewportName);
			});

			await test.step("Saving prefilled Azure subscription variables", async () => {
				await expect(azureSubscriptionCard.getByText("Loading subscriptions...")).toBeHidden();
				const subscriptionSelect = azureSubscriptionCard.getByRole("combobox");
				await expect(subscriptionSelect).toBeVisible();
				await subscriptionSelect.click();
				const subscriptionOption = page.getByRole("option").filter({ hasText: mockSubscriptionId });
				await expect(subscriptionOption).toBeVisible();
				await subscriptionOption.click();
				await expect(subscriptionSelect).toContainText("Mock subscription");
				const saveButton = azureSubscriptionCard.getByRole("button", { name: "Save 2 variables" });
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "before-save", viewportName);
				await saveButton.click();
				await expect(azureSubscriptionCard.getByRole("button", { name: "Save variables" })).toBeDisabled();
				await expectSnapshot(page, azureSubscriptionCard, testInfo, "end", viewportName);
			});
		});

		test("Selecting an existing repository with environment variables already saved", async ({ page, context }, testInfo) => {
			const result = await prepareMockAzureSubscription(
				page,
				context,
				`mock-existing-subscription-${viewportName.toLowerCase()}`,
				{ initialVariables: savedAzureVariables },
			);
			await expect(result.tenantVariableInput).not.toHaveValue("");
			await expect(result.subscriptionVariableInput).not.toHaveValue("");
			await expect(result.azureSubscriptionCard.getByText("Unsaved change — save to apply.", { exact: true })).toHaveCount(0);
			await expect(result.saveButton).toBeDisabled();
			await expectSnapshot(page, result.azureSubscriptionCard, testInfo, "edge-case-existing-repo", viewportName);
		});

		test("Modifying one existing prefilled variable", async ({ page, context }, testInfo) => {
			const result = await prepareMockAzureSubscription(
				page,
				context,
				`mock-modify-one-${viewportName.toLowerCase()}`,
				{ initialVariables: savedAzureVariables },
			);
			const savedSubscriptionId = await result.subscriptionVariableInput.inputValue();
			await result.subscriptionVariableInput.fill(`${savedSubscriptionId}-modified`);
			await expect(result.azureSubscriptionCard.getByRole("button", { name: "Save 1 variable" })).toBeEnabled();
			await expect(result.azureSubscriptionCard.getByText("overwrites", { exact: true })).toBeVisible();
			await result.azureSubscriptionCard.getByRole("button", { name: "Revert to saved value" }).click();
			await expect(result.subscriptionVariableInput).toHaveValue(savedSubscriptionId);
			await expect(result.saveButton).toBeDisabled();
			await expectSnapshot(page, result.azureSubscriptionCard, testInfo, "edge-case-variable-modified", viewportName);
		});

		test("Modifying all existing prefilled variables", async ({ page, context }, testInfo) => {
			const result = await prepareMockAzureSubscription(
				page,
				context,
				`mock-modify-all-${viewportName.toLowerCase()}`,
				{ initialVariables: savedAzureVariables },
			);
			const savedTenantId = await result.tenantVariableInput.inputValue();
			const savedSubscriptionId = await result.subscriptionVariableInput.inputValue();
			await result.tenantVariableInput.fill("modified");
			await result.subscriptionVariableInput.fill("modified");
			await expect(result.azureSubscriptionCard.getByText("overwrites", { exact: true })).toHaveCount(2);
			for (const key of ["AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID"]) {
				await result.azureSubscriptionCard
					.getByText(key, { exact: true })
					.locator("..")
					.locator("..")
					.getByRole("button", { name: "Revert to saved value" })
					.click();
			}
			await expect(result.tenantVariableInput).toHaveValue(savedTenantId);
			await expect(result.subscriptionVariableInput).toHaveValue(savedSubscriptionId);
			await expect(result.saveButton).toBeDisabled();
			await expectSnapshot(page, result.azureSubscriptionCard, testInfo, "edge-case-both-variables-modified", viewportName);
		});

		test("Both prefilled variables are removed before saving", async ({ page, context }, testInfo) => {
			const result = await prepareMockAzureSubscription(
				page,
				context,
				`mock-remove-all-${viewportName.toLowerCase()}`,
				{ initialVariables: savedAzureVariables },
			);
			await result.tenantVariableInput.fill("");
			await result.subscriptionVariableInput.fill("");
			const removeButton = result.azureSubscriptionCard.getByRole("button", { name: "Save 2 variables" });
			await expect(removeButton).toBeEnabled();
			await removeButton.click();
			await expect(result.tenantVariableInput).toHaveValue("");
			await expect(result.subscriptionVariableInput).toHaveValue("");
			await expect(result.azureSubscriptionCard.getByText("2 not configured", { exact: true })).toBeVisible();
			await expectSnapshot(page, result.azureSubscriptionCard, testInfo, "edge-case-both-variables-removed", viewportName);
		});
	});
}
