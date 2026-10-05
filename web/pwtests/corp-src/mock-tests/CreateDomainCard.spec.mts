// UI component: ../../../corp-src/cards/CreateDomainCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot, safePathSegment } from "../../util/testHelper.ts";
import {
	expandAzureAppRegistrationCard,
	expandAzureLoginCard,
	expandAzureSubscriptionCard,
	expandRepoCard,
} from "../util/cardHelper.mts";
import { createNewRepo } from "../util/testHelper.mts";
import {
	coreInfraStepLabels,
	expectSuccessfulSteps,
	cacheMockAzureGraphScopeSets,
	installCoreInfraAzureMock,
	installCreateDomainAzureMock,
	installMockAzure,
	installMockGitHub,
	signInMockAzure,
} from "../util/mockTestHelper.mts";

const companyShortCode = "pwtests";
const domainName = "pwtests.example";

const initialSetupStepLabels = [
	"Confirm Microsoft permissions",
	"Register required Azure resource providers",
	`Create DNS zone ${domainName}`,
	"Add custom domain to Entra ID",
	"Create domain-verification TXT record",
	"Set as primary domain",
	"Grant domain permission to the pipeline",
];

const rerunStepLabels = [
	"Confirm Microsoft permissions",
	"Register required Azure resource providers",
	"Add custom domain to Entra ID",
	"Create domain-verification TXT record",
	"Set as primary domain",
	"Grant domain permission to the pipeline",
];

async function openDomainCard(card: import("@playwright/test").Locator) {
	const description = card.getByText(/Creates the DNS zone for/i);
	if (await description.isVisible()) return;

	await card.getByText("Core domain", { exact: true }).first().click();
	await expect(description).toBeVisible();
}

async function prepareDomainCard(
	page: import("@playwright/test").Page,
	context: import("@playwright/test").BrowserContext,
	viewportName: string,
) {
	const repoName = safePathSegment(`mock-create-domain-${viewportName.toLowerCase()}`);
	const github = await installMockGitHub(page, context, {
		initialVariables: {
			NAME: companyShortCode,
			COMPANY_SHORT_CODE: companyShortCode,
		},
	});
	await installMockAzure(page);
	await page.goto(CORP_URL);

	const azureLoginCard = await expandAzureLoginCard(page);
	const azureClientId = await signInMockAzure(page);
	await expect(azureLoginCard.getByText(/Signed in as/i)).toBeVisible();
	const tenantSelect = azureLoginCard.getByTestId("tenant-select");
	await expect(tenantSelect).toBeVisible();
	await tenantSelect.click();
	await page.getByRole("option", { name: /Mock tenant/i }).click();

	const repoCard = await expandRepoCard(page);
	await createNewRepo(page, repoCard, repoName);
	await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
	const prodEnvironment = repoCard.getByText("PROD", { exact: true });
	await expect(prodEnvironment).toBeVisible();
	await prodEnvironment.click();
	const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
	if (await createProdButton.isVisible()) {
		await createProdButton.click();
		await expect(createProdButton).toBeHidden();
	}

	const azureSubscriptionCard = await expandAzureSubscriptionCard(page);
	await expect(azureSubscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden();
	await expect(azureSubscriptionCard.getByRole("combobox")).toBeVisible();
	await azureSubscriptionCard.getByRole("button", { name: "Save 2 variables" }).click();
	await expect(azureSubscriptionCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled();

	const appRegistrationCard = await expandAzureAppRegistrationCard(page);
	await appRegistrationCard.locator("input:visible").first().fill("zeninstaller-mock-create-domain");
	await appRegistrationCard.getByRole("button", { name: "Create app registration" }).click();
	await expect(appRegistrationCard.getByText("Running...", { exact: true })).toBeHidden();
	await expect(appRegistrationCard.getByRole("button", { name: "Try again" })).toBeVisible();
	await expect(appRegistrationCard.getByText(/Connection details saved(?: — no changes needed)?\./i)).toBeVisible();
	await expect(appRegistrationCard.getByText(/Additional consent required|Consent redirect failed/i)).toHaveCount(0);

	const azure = await installCreateDomainAzureMock(page, domainName);

	await installCoreInfraAzureMock(page);

	const coreInfraCard = page.locator("#card-core_infra");
	await coreInfraCard.getByText("Terraform state backend", { exact: true }).click();
	await expect(coreInfraCard.getByText("Complete the Azure app registration", { exact: true })).toBeHidden();
	await coreInfraCard.getByRole("button", { name: "Create core infrastructure" }).click();
	await expect(coreInfraCard.getByText("Running...", { exact: true })).toBeHidden();
	await expectSuccessfulSteps(coreInfraCard, coreInfraStepLabels(companyShortCode));
	await expect(coreInfraCard.getByRole("button", { name: "Start over" })).toBeVisible();

	await cacheMockAzureGraphScopeSets(page, azureClientId, [
		[
			"https://graph.microsoft.com/Domain.ReadWrite.All",
			"https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
			"https://graph.microsoft.com/Application.Read.All",
			"https://graph.microsoft.com/Application.ReadWrite.All",
		],
		["https://graph.microsoft.com/Domain.ReadWrite.All"],
		["https://graph.microsoft.com/Organization.Read.All"],
	]);

	const card = page.locator("#card-create_domain");
	await openDomainCard(card);

	return { card, prepared: { github }, azure };
}

test.beforeEach(async ({ page }) => {
	await page.coverage.startJSCoverage({ resetOnNavigation: false });
});

test.afterEach(async ({ page }, testInfo) => {
	if (page.isClosed()) return;

	const entries = await page.coverage.stopJSCoverage();
	const file = testInfo.outputPath("v8-coverage.json");
	await writeFile(file, JSON.stringify(entries), "utf8");
	await testInfo.attach("v8-coverage", { path: file, contentType: "application/json" });
});

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Create Domain Card Mock - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });

		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(180_000);
			const { card, prepared, azure } = await prepareDomainCard(page, context, viewportName);
			await expectSnapshot(page, card, testInfo, "start", viewportName);

			await test.step("Save variables then set up corp domain", async () => {
				const domainInput = card.getByText("DNS Domain", { exact: true }).locator("../..").getByRole("textbox");
				await expect(domainInput).toBeVisible();
				await expect(card.getByRole("progressbar")).toBeHidden();

				await domainInput.fill(domainName);
				await card.getByRole("button", { name: "Save 1 variable" }).click();
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled();
				await expect(domainInput).toHaveValue(domainName);

				const setupButton = card.getByRole("button", { name: "Set up core DNS domain" });
				await expect(setupButton).toBeEnabled();
				await expect(card.getByText("Checking whether this domain is already set up...")).toBeHidden({
					timeout: 50_000,
				});
				await setupButton.click();

				await expect(card.getByText("Running...", { exact: true })).toBeHidden();
				await expectSuccessfulSteps(card, initialSetupStepLabels);
				await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
				await expect(card.getByRole("button", { name: "Start over" })).toBeVisible();
				await expectSnapshot(page, card, testInfo, "new-setup", viewportName);
			});

			await test.step("Reuse the existing Corp domain", async () => {
				await page.reload();
				await openDomainCard(card);

				const rerunButton = card.getByRole("button", { name: "Re-run setup" });
				await expect(rerunButton).toBeVisible();
				await rerunButton.click();
				await expect(card.getByText("Running...", { exact: true })).toBeHidden();
				await expectSuccessfulSteps(card, rerunStepLabels);
				await expect(card.getByText(/Failed|Consent redirect failed|Additional consent required/i)).toHaveCount(0);
				await expect(card.getByRole("button", { name: "Start over" })).toBeVisible();
				await expectSnapshot(page, card, testInfo, "existing-setup", viewportName);
			});

			await test.step("Verify the domain card completion state", async () => {
				await page.reload();
				await openDomainCard(card);

				await expect(card.getByText("Resources", { exact: true })).toBeVisible();
				await expect(card.getByText(/DNS zone:/i)).toBeVisible();
				await expect(card.getByText("Point your domain at Azure DNS", { exact: true })).toBeVisible();
				await expect(card.getByRole("button", { name: "Verify domain now" })).toBeEnabled();
				expect(azure.domainVerified).toBe(false);
				expect(azure.domainPrimary).toBe(false);
				expect(azure.adminConsentGranted).toBe(true);
				expect(prepared.github.variables.DNS).toBe(domainName);
				await expectSnapshot(page, card, testInfo, "end", viewportName);
			});
		});
	});
}
