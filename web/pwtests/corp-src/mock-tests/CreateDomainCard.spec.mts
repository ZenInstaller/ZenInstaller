// UI component: ../../../corp-src/cards/CreateDomainCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot, safePathSegment } from "../../util/testHelper.ts";
import {
	expectSuccessfulSteps,
	installCoreInfraAzureMock,
	installCreateDomainAzureMock,
	installMockAzure,
	installMockGitHub,
	mockSubscriptionId,
	mockTenantId,
} from "../util/mockTestHelper.mts";

const companyShortCode = "pwtests";
const domainName = "pwtests.example";
const mockClientId = "00000000-0000-0000-0000-000000000002";

// Served in place of the Vite MSAL module only for this mock test.
const authenticationModule = `
export const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const tenantId = ${JSON.stringify(mockTenantId)};
const account = {
	homeAccountId: "mock-home." + tenantId,
	environment: "login.microsoftonline.com",
	tenantId,
	localAccountId: "mock-user-id",
	username: "mock-user@example.com",
	name: "Mock Azure User",
	tenantProfiles: new Map([[tenantId, { tenantId, isHomeTenant: true }]]),
};

const rejectRedirect = async () => {
	throw new Error("Unexpected authentication redirect in a mock test.");
};

const msal = {
	handleRedirectPromise: async () => null,
	getAllAccounts: () => [account],
	acquireTokenSilent: async () => ({ account, accessToken: "mock-access-token" }),
	acquireTokenRedirect: rejectRedirect,
	loginRedirect: rejectRedirect,
	clearCache: async () => {},
};

export const getMsal = async () => msal;
export const ensureScopeConsent = async () => false;
export const getToken = async () => "mock-access-token";

let activeAccount = null;
export function setActiveAzureIdentity(value) {
	activeAccount = value;
}

export const getMsToken = async () => activeAccount ? "mock-access-token" : null;
export async function requireMsToken() {
	const token = await getMsToken();
	if (!token) throw new Error("No mocked Microsoft account is active.");
	return token;
}
`;

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
	const unexpectedRequests: string[] = [];
	await context.route("**/*", async (route) => {
		if (new URL(route.request().url()).origin === new URL(CORP_URL).origin) {
			return route.continue();
		}
		unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
		await route.abort("blockedbyclient");
	});
	await context.route("https://js.monitor.azure.com/scripts/b/ai.config.1.cfg.json", (route) =>
		route.fulfill({ json: { enabled: false } }),
	);
	await context.route("https://australiaeast-1.in.applicationinsights.azure.com/v2/track", (route) =>
		route.fulfill({ status: 200, json: { itemsReceived: 0, itemsAccepted: 0, errors: [] } }),
	);
	await page.route(/\/corp-src\/cards\/AzureLogin\/msal\.ts(?:\?.*)?$/, (route) =>
		route.fulfill({ contentType: "application/javascript", body: authenticationModule }),
	);
	await context.addInitScript(({ clientId, tenantId, subscriptionId, corpName }) => {
		localStorage.setItem("zeninstaller_azure_result", JSON.stringify({
			clientId, tenantId, subscriptionIds: [subscriptionId],
		}));
		localStorage.setItem("zeninstaller_infra_result", JSON.stringify({ corpName, subscriptionId }));
		sessionStorage.setItem("zeninstaller_arm_tenant", tenantId);
	}, { clientId: mockClientId, tenantId: mockTenantId, subscriptionId: mockSubscriptionId, corpName: companyShortCode });
	const github = await installMockGitHub(page, context, {
		repositoryName: repoName,
		branches: ["main", "PROD"],
		initialVariables: {
			NAME: companyShortCode,
			AZURE_TENANT_ID: mockTenantId,
			AZURE_SUBSCRIPTION_ID: mockSubscriptionId,
			AZURE_CLIENT_ID: mockClientId,
			AZURE_PLAN_CLIENT_ID: mockClientId,
		},
	});
	await installMockAzure(page, {
		appDisplayName: "zeninstaller-mock-create-domain",
		servicePrincipalCreated: true,
		rbacAssigned: true,
	});
	const azure = await installCreateDomainAzureMock(page, domainName);
	const infrastructure = await installCoreInfraAzureMock(page);
	infrastructure.createdResources.add("resource-group");
	infrastructure.roleAssignments.set(`/subscriptions/${mockSubscriptionId}/resourcegroups/root-${companyShortCode}`,
		new Set(["acdd72a7-3385-48ef-bd42-f606fba81ae7"]));
	const url = new URL(CORP_URL);
	url.search = new URLSearchParams({
		account: "mock-user", repo: repoName, env: "PROD", tenant: mockTenantId, subscription: mockSubscriptionId,
	}).toString();
	await page.goto(url.toString());
	const card = page.locator("#card-create_domain");
	await openDomainCard(card);
	await expect(card.getByRole("textbox")).toBeVisible();
	return { card, prepared: { github }, azure, unexpectedRequests };
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
			const { card, prepared, azure, unexpectedRequests } = await prepareDomainCard(page, context, viewportName);
			await expectSnapshot(page, card, testInfo, "start", viewportName);

			await test.step("Save variables then set up corp domain", async () => {
				const domainInput = card.getByRole("textbox");
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
				await expect(card.getByRole("button", { name: "Verify domain now" })).toBeEnabled();
				expect(azure.domainVerified).toBe(false);
				expect(azure.domainPrimary).toBe(false);
				expect(azure.adminConsentGranted).toBe(true);
				expect(prepared.github.variables.DNS).toBe(domainName);
				await expectSnapshot(page, card, testInfo, "end", viewportName);
			});
			expect(unexpectedRequests, "All non-app requests must be fulfilled by mocks").toEqual([]);
		});
	});
}
