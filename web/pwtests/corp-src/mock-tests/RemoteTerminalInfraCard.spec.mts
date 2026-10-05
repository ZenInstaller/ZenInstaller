/// <reference types="node" />
// UI component: ../../../corp-src/cards/RemoteTerminalInfraCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { expectSuccessfulSteps } from "../util/mockTestHelper.mts";
import { connectionInput, openConnectionDetails, openRemoteTerminalCard, remoteTerminalStepLabels } from "../util/RemoteTerminalInfraCardHelper.mts";
import { installRelayNetworkGuard, prepareMockRelay } from "../util/RemoteTerminalInfraCardMockHelper.mts";

test.beforeEach(async ({ page }) => {
	await page.coverage.startJSCoverage({ resetOnNavigation: false });
});
test.afterEach(async ({ page }, testInfo) => {
	if (page.isClosed()) return;
	const file = testInfo.outputPath("v8-coverage.json");
	await writeFile(file, JSON.stringify(await page.coverage.stopJSCoverage()), "utf8");
	await testInfo.attach("v8-coverage", { path: file, contentType: "application/json" });
});

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Remote Terminal Infrastructure Card Mock - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });
		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(180_000);
			const { card, corpName, tenantId, github, azure, resources, writes, unexpectedRequests } =
				await prepareMockRelay(page, context, viewportName);
			await expectSnapshot(page, card, testInfo, "start", viewportName);
			await test.step("Create the relay in the existing repository environment", async () => {
				await card.getByRole("button", { name: "Create terminal relay", exact: true }).click();
				await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled({ timeout: 60_000 });
				await expectSuccessfulSteps(card, remoteTerminalStepLabels(corpName));
				await openConnectionDetails(card);
				await expect(connectionInput(card, "WEBPUBSUB_ENDPOINT")).toHaveValue(`${corpName}-wpubsub.webpubsub.azure.com`);
				await expect(connectionInput(card, "BACKEND_API")).toHaveValue(`https://${corpName}-terminal-app.azurewebsites.net`);
				await expect(connectionInput(card, "WEBPUBSUB_TENANT_ID")).toHaveValue(tenantId);
				await expect(connectionInput(card, "WEBPUBSUB_CLIENT_ID")).toHaveValue(/^[0-9a-f-]{36}$/i);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });
				expect(github.repositoryName).toBe(`pwtests-${viewportName}`);
				expect(github.variables.BACKEND_API).toBe(`https://${corpName}-terminal-app.azurewebsites.net`);
				expect(azure.federatedSubjects).toEqual(new Set([
					`repo:mock-user@12345/pwtests-${viewportName}@987654321:environment:PROD`,
					`repo:mock-user@12345/pwtests-${viewportName}@987654321:environment:TEST`,
				]));
				expect(resources.size).toBe(9);
				const functionWrite = writes.find(({ path }) => path.endsWith("/sites/pwtests-terminal-app"));
				expect(functionWrite?.body.identity).toEqual({ type: "SystemAssigned" });
				const roleWrites = writes.filter(({ path }) => path.includes("/providers/microsoft.authorization/roleassignments/"));
				expect(roleWrites).toHaveLength(6);
				const root = "/subscriptions/mock-subscription/resourcegroups/root-pwtests/providers";
				for (const [scope, roleId, principalId] of [
					[`${root}/microsoft.storage/storageaccounts/pwteststerm`, "ba92f5b4-2d11-453d-a403-e96b0029c9fe", "mock-function-principal"],
					[`${root}/microsoft.storage/storageaccounts/pwteststerm`, "974c5e8b-45b9-4653-ba55-5f855dd0fb88", "mock-function-principal"],
					[`${root}/microsoft.storage/storageaccounts/pwteststerm`, "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3", "mock-function-principal"],
					[`${root}/microsoft.signalrservice/webpubsub/pwtests-wpubsub`, "12cf5a90-567b-43ae-8102-96cf46c7d9b4", "mock-function-principal"],
					[`${root}/microsoft.insights/components/pwtests-terminal-ai`, "3913510d-42f4-4e42-8a64-420c390055eb", "mock-function-principal"],
					[`${root}/microsoft.signalrservice/webpubsub/pwtests-wpubsub`, "12cf5a90-567b-43ae-8102-96cf46c7d9b4", "mock-pipeline-principal"],
				]) {
					expect(roleWrites).toEqual(expect.arrayContaining([{
						path: expect.stringMatching(new RegExp(`^${scope}/providers/microsoft\\.authorization/roleassignments/`)),
						body: { properties: {
							principalId, principalType: "ServicePrincipal",
							roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
						} },
					}]));
				}
				await expectSnapshot(page, card, testInfo, "created", viewportName);
			});
			const clientId = await connectionInput(card, "WEBPUBSUB_CLIENT_ID").inputValue();
			await test.step("Reload and read saved connection details", async () => {
				await page.reload();
				await openRemoteTerminalCard(page);
				await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled();
				await expect(card.getByText(`Resource group: root-${corpName}`, { exact: true })).toBeVisible();
				await openConnectionDetails(card);
				await expect(connectionInput(card, "WEBPUBSUB_CLIENT_ID")).toHaveValue(clientId);
				await expect(connectionInput(card, "WEBPUBSUB_TENANT_ID")).toHaveValue(tenantId);
				await expect(connectionInput(card, "WEBPUBSUB_ENDPOINT")).toHaveValue(`${corpName}-wpubsub.webpubsub.azure.com`);
				await expect(connectionInput(card, "BACKEND_API")).toHaveValue(github.variables.BACKEND_API);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled();
				await expectSnapshot(page, card, testInfo, "persisted", viewportName);
			});
			await test.step("Re-run setup without replacing the pipeline identity", async () => {
				const writeCount = writes.length;
				await card.getByRole("button", { name: "Re-run", exact: true }).click();
				await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled({ timeout: 60_000 });
				await expectSuccessfulSteps(card, remoteTerminalStepLabels(corpName));
				await expect(connectionInput(card, "WEBPUBSUB_CLIENT_ID")).toHaveValue(clientId);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled();
				expect(writes).toHaveLength(writeCount);
				await expectSnapshot(page, card, testInfo, "rerun", viewportName);
			});
			await test.step("Keep an unsaved connection edit while details are collapsed", async () => {
				const input = connectionInput(card, "BACKEND_API");
				const original = await input.inputValue();
				await input.fill("https://unsaved.example");
				await expect(card.getByRole("button", { name: "Save 1 variable", exact: true })).toBeEnabled();
				await card.getByText("collapse", { exact: true }).click();
				await expect(input).toBeHidden();
				await openConnectionDetails(card);
				await expect(input).toHaveValue("https://unsaved.example");
				await input.fill(original);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled();
				expect(github.variables.BACKEND_API).toBe(original);
				await expectSnapshot(page, card, testInfo, "draft-restored", viewportName);
			});
			expect(unexpectedRequests, "No unmocked external requests").toEqual([]);
		});
		test("Shows provisioning failure and allows a successful retry", async ({ page, context }, testInfo) => {
			test.setTimeout(180_000);
			const { card, corpName, github, unexpectedRequests } =
				await prepareMockRelay(page, context, viewportName, { failProvisioningOnce: true });
			await card.getByRole("button", { name: "Create terminal relay", exact: true }).click();
			await expect(card.getByText(/Mock provisioning permission denied/)).toBeVisible();
			await expect(card.getByRole("button", { name: "Create terminal relay", exact: true })).toBeEnabled();
			expect(github.variables.WEBPUBSUB_CLIENT_ID).toBeUndefined();
			expect(github.variables.BACKEND_API).toBeUndefined();
			await card.getByRole("button", { name: "Create terminal relay", exact: true }).click();
			await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled({ timeout: 60_000 });
			await expectSuccessfulSteps(card, remoteTerminalStepLabels(corpName));
			await expect(card.getByText(/Mock provisioning permission denied/)).toHaveCount(0);
			await openConnectionDetails(card);
			await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });
			expect(github.variables.BACKEND_API).toBe("https://pwtests-terminal-app.azurewebsites.net");
			await expectSnapshot(page, card, testInfo, "recovered", viewportName);
			expect(unexpectedRequests, "No unmocked external requests").toEqual([]);
		});
		test("Requires authentication before creating relay resources", async ({ page, context }, testInfo) => {
			const unexpectedRequests = await installRelayNetworkGuard(context);
			await page.goto(CORP_URL);
			const card = page.locator("#card-remote_terminal_infra");
			await card.getByText("Private Zeninstaller Environment", { exact: true }).click();
			await expect(card.getByText("Sign in to Azure", { exact: true })).toBeVisible();
			await expect(card.getByRole("button", { name: /Create terminal relay|Re-run/ })).toHaveCount(0);
			await expectSnapshot(page, card, testInfo, "authentication-required", viewportName);
			expect(unexpectedRequests, "No unmocked external requests").toEqual([]);
		});
	});
}
