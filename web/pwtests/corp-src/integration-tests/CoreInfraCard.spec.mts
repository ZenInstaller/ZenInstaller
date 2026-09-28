// UI component: ../../../corp-src/cards/CoreInfraCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, SUBSCRIPTION_ID, TEST_REPO_MAIN, viewports } from "../../testInit";
import { expectSnapshot, safePathSegment } from "../../util/testHelper.ts";
import {
	expandAzureAppRegistrationCard,
	expandAzureLoginCard,
	expandAzureSubscriptionCard,
	expandRepoCard,
} from "../util/cardHelper.mts";
import { checkRepoExists, chooseExistingRepo } from "../util/testHelper.mts";
import { restoreAzureSessionStorage, restoreGithubSessionStorage } from "../util/setupHelper.mts";

async function prepareExistingAzureSubscription(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, viewportName: string) {
	await restoreGithubSessionStorage(context);
	await restoreAzureSessionStorage(context);
	await page.goto(CORP_URL);

	const azureCard = await expandAzureLoginCard(page);
	const tenantSelect = azureCard.getByTestId("tenant-select");
	await expect(tenantSelect).toBeVisible({ timeout: 120_000 });
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
	await expect(subscriptionCard.getByText(/Pick the subscription to deploy into\./i)).toBeVisible();
	await expect(subscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden({ timeout: 60_000 });
	await expect(subscriptionCard.getByRole("combobox")).toBeVisible({ timeout: 100_000 });
	const subscriptionSelect = subscriptionCard.getByRole("combobox");
	await subscriptionSelect.click();
	const subscriptionOption = page.getByRole("option").filter({ hasText: SUBSCRIPTION_ID });
	await expect(subscriptionOption).toBeVisible({ timeout: 30_000 });
	await subscriptionOption.click();
	const saveButton = subscriptionCard.getByRole("button", { name: /^Save(?: 2)? variables$/ });
	if ((await saveButton.count()) > 0 && await saveButton.isEnabled({ timeout: 0 })) {
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
	test.describe(`Core Infrastructure Card - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });

		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(600_000);
			const companyShortCode = "pwtests";
			let setupAlreadyExists = false;

			await test.step("Prepare the selected Azure subscription", async () => {
				await prepareExistingAzureSubscription(page, context, viewportName);
			});

            const terraformCard = await test.step("Expand the Terraform state backend card", async() => {
				const terraformCard = page.locator("#card-core_infra");
				return terraformCard;
			})

			await test.step("Open backend card where core infrastructure does not exist", async () => {
				await terraformCard.getByText("Terraform state backend", { exact: true }).click();
				await expect(terraformCard.getByText("Company short code")).toBeVisible({ timeout: 120_000 });
				// await expectSnapshot(page, terraformCard, testInfo, "start", viewportName);

				setupAlreadyExists = await terraformCard.getByRole("button", { name: "Re-run setup" }).isVisible().catch(() => false);
				if (setupAlreadyExists) {
					await expect(terraformCard.getByRole("button", { name: "Re-run setup" })).toBeVisible();
					await expectSnapshot(page, terraformCard, testInfo, "already-existing-start", viewportName);
				} else {
					await terraformCard
						.getByText("COMPANY_SHORT_CODE", { exact: true })
						.locator("../..")
						.getByRole("textbox")
						.fill(companyShortCode);
					const saveVariablesButton = terraformCard.getByRole("button", { name: /^Save\s+(?:\d+\s+)?variables?$/ });
					if (await saveVariablesButton.isEnabled()) {
						await saveVariablesButton.click();
						await expect(terraformCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled({ timeout: 60_000 });
					}
					await expect(terraformCard.getByText("Create core infrastructure")).toBeVisible({ timeout: 120_000 });
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

					for (const stepLabel of [
						"Confirm Microsoft permissions",
						"Register required Azure resource providers",
						"Grant GitHub Actions access to the resource group",
						"Configure subscription activity-log diagnostics",
						"Grant GitHub Actions access to Terraform state",
					]) {
						await expect(card.getByText(stepLabel, { exact: true })).toBeVisible();
					}
					await expect(card.getByRole("button", { name: "Start over" })).toBeVisible();
					await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
					await expectSnapshot(page, card, testInfo, "provisioned", viewportName);
				});
			}

			await test.step("Verify the completed card state", async () => {
				const card = page.locator("#card-core_infra");
				await expect(card.getByText("Terraform state backend")).toBeVisible();
				await expect(card.getByText("State container:")).toBeVisible();
				await expectSnapshot(page, card, testInfo, "end", viewportName);
			});

			await test.step("Re-run existing core infrastructure setup", async () => {
				const card = page.locator("#card-core_infra");
				const resources = card.getByText("Resources", { exact: true });

				if (!(await resources.isVisible().catch(() => false))) {
					await card.getByRole("button", { name: "Start over" }).click();
				}

				await expect(resources).toBeVisible({ timeout: 120_000 });
				const rerunButton = card.getByRole("button", { name: "Re-run setup" });
				await expect(rerunButton).toBeVisible({ timeout: 120_000 });
				await rerunButton.click();
				await expect(card.getByText("Running...", { exact: true })).toBeHidden({ timeout: 500_000 });
				await expect(card.getByText("Already exists", { exact: true }).first()).toBeVisible();
				await expect(card.getByRole("button", { name: "Start over" })).toBeVisible();
				await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
				await expectSnapshot(page, card, testInfo, "rerun-complete", viewportName);
			});
		});
	});
}