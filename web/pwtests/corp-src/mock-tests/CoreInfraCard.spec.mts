import { expect, test } from "@playwright/test";
import { writeFile } from "fs/promises";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { expandAzureAppRegistrationCard } from "../util/cardHelper.mts";
import {
	coreInfraStepLabels,
	expectSuccessfulSteps,
	installCoreInfraAzureMock,
	installMockGitHub,
	mockSubscriptionId,
	prepareMockAzureSubscription,
} from "../util/mockTestHelper.mts";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Core Infrastructure Card Mock - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });

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

		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(180_000);
			const companyShortCode = "pwtests";
			const prepared = await prepareMockAzureSubscription(
				page,
				context,
				`mock-core-infra-${viewportName.toLowerCase()}`,
				{ saveVariables: true },
			);
			const azureMock = await installCoreInfraAzureMock(page);
			await page.reload();

			const appRegistrationCard = await expandAzureAppRegistrationCard(page);
			const appNameInput = appRegistrationCard.locator("input:visible").first();
			await appNameInput.fill(`mock-core-infra-${viewportName.toLowerCase()}`);
			await appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
			await expect(appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
			await expect(appRegistrationCard.getByRole("button", { name: "Try again" })).toBeVisible();
			await expect(appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i)).toBeVisible();

			const card = page.locator("#card-core_infra");
			await card.getByText("Terraform state backend", { exact: true }).click();
			await expect(card.getByText("Company short code", { exact: true })).toBeVisible();
			await expectSnapshot(page, card, testInfo, "start", viewportName);

			await test.step("Open backend card where core infrastructure does not exist", async () => {
				const companyInput = card
					.getByText("COMPANY_SHORT_CODE", { exact: true })
					.locator("../..")
					.getByRole("textbox");
				await companyInput.fill(companyShortCode);
				const saveButton = card.getByRole("button", { name: /^Save 1 variable$/ });
				await saveButton.click();
				await expect(card.getByRole("button", { name: /^Save variables$/ })).toBeDisabled();
				await expect(card.getByRole("button", { name: "Create core infrastructure" })).toBeEnabled();
				await expectSnapshot(page, card, testInfo, "not-setup-start", viewportName);
			});

			await test.step("Provision the Terraform state backend", async () => {
				await card.getByRole("button", { name: "Create core infrastructure" }).click();
				await expect(card.getByText("Running...", { exact: true })).toBeHidden();
				await expectSuccessfulSteps(card, coreInfraStepLabels(companyShortCode));
				await expect(card.getByRole("button", { name: "Start over" })).toBeVisible();
				await expect([...azureMock.createdResources]).toEqual(
					expect.arrayContaining([
						"resource-group",
						"log-analytics",
						"diagnostics",
						"app-insights",
						"storage-account",
						"storage-container",
					]),
				);
				await expectSnapshot(page, card, testInfo, "provisioned", viewportName);
			});

			await test.step("Verify the completed card state", async () => {
				await card.getByRole("button", { name: "Start over" }).click();
				const reloadedCard = page.locator("#card-core_infra");
				if (!(await reloadedCard.getByText("Company short code", { exact: true }).isVisible().catch(() => false))) {
					await reloadedCard.getByText("Terraform state backend", { exact: true }).click();
				}
				await expect(reloadedCard.getByText("Resources", { exact: true })).toBeVisible();
				await expect(reloadedCard.getByText("State container:", { exact: false })).toBeVisible();
				await expectSnapshot(page, reloadedCard, testInfo, "end", viewportName);
			});

			await test.step("Re-run existing core infrastructure setup", async () => {
				const reloadedCard = page.locator("#card-core_infra");
				await reloadedCard.getByRole("button", { name: "Create core infrastructure" }).click();
				await expect(reloadedCard.getByText("Running...", { exact: true })).toBeHidden();
				await expectSuccessfulSteps(reloadedCard, coreInfraStepLabels(companyShortCode));
				await expect(reloadedCard.getByText("Already exists", { exact: true }).first()).toBeVisible();
				await expect(reloadedCard.getByRole("button", { name: "Start over" })).toBeVisible();
				await expectSnapshot(page, reloadedCard, testInfo, "rerun-complete", viewportName);
			});

			const readerRoleId = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
			const storageReaderRoleId = "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1";
			expect(azureMock.roleAssignments.get(`/subscriptions/${mockSubscriptionId}/resourcegroups/root-${companyShortCode}`)).toContain(readerRoleId);
			expect(azureMock.roleAssignments.get(`/subscriptions/${mockSubscriptionId}/resourcegroups/root-${companyShortCode}/providers/microsoft.storage/storageaccounts/${companyShortCode}pvt`)).toContain(storageReaderRoleId);
			expect(prepared.github.variables.NAME).toBe(companyShortCode);
		});

		test("Shows prerequisites before infrastructure setup", async ({ page, context }, testInfo) => {
			await installMockGitHub(page, context);
			await page.goto(CORP_URL);
			const card = page.locator("#card-core_infra");
			await card.getByText("Terraform state backend", { exact: true }).click();

			await expect(card.getByText("Complete these first", { exact: true })).toBeVisible();
			for (const prerequisite of [
				"Sign in to Azure",
				"Select a repository & environment",
				"Select a subscription",
				"Complete the Azure app registration",
			]) {
				await expect(card.getByText(prerequisite, { exact: true })).toBeVisible();
			}
			await expect(card.getByRole("button", { name: "Create core infrastructure" })).toHaveCount(0);
			await expectSnapshot(page, card, testInfo, "prerequisites-required", viewportName);
		});
	});
}