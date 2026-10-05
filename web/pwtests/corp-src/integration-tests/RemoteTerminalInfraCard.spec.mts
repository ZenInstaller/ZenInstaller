/// <reference types="node" />
// UI component: ../../../corp-src/cards/RemoteTerminalInfraCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { expectSuccessfulSteps } from "../util/mockTestHelper.mts";
import {
	connectionInput,
	openConnectionDetails,
	openRemoteTerminalCard,
	prepareExistingRelayRepository,
	remoteTerminalStepLabels,
} from "../util/RemoteTerminalInfraCardHelper.mts";

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
	test.describe(`Remote Terminal Infrastructure Card - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });

		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(1_200_000);
			const { card, corpName, tenantId } = await prepareExistingRelayRepository(page, context, viewportName);
			await expectSnapshot(page, card, testInfo, "start", viewportName);

			await test.step("Create the relay in the existing repository environment", async () => {
				const create = card.getByRole("button", { name: /^(?:Create terminal relay|Re-run)$/ });
				await expect(create).toBeEnabled();
				await create.click();
				await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled({ timeout: 600_000 });
				await expectSuccessfulSteps(card, remoteTerminalStepLabels(corpName));
				await openConnectionDetails(card);
				await expect(connectionInput(card, "WEBPUBSUB_ENDPOINT")).toHaveValue(`${corpName}-wpubsub.webpubsub.azure.com`);
				await expect(connectionInput(card, "BACKEND_API")).toHaveValue(`https://${corpName}-terminal-app.azurewebsites.net`);
				await expect(connectionInput(card, "WEBPUBSUB_TENANT_ID")).toHaveValue(tenantId);
				await expect(connectionInput(card, "WEBPUBSUB_CLIENT_ID")).toHaveValue(/^[0-9a-f-]{36}$/i);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });
				await expect(card.getByText(/\d+ not configured|Failed to/i)).toHaveCount(0);
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
				await expect(connectionInput(card, "BACKEND_API")).toHaveValue(`https://${corpName}-terminal-app.azurewebsites.net`);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled();
				await expectSnapshot(page, card, testInfo, "persisted", viewportName);
			});

			await test.step("Re-run setup without replacing the pipeline identity", async () => {
				await card.getByRole("button", { name: "Re-run", exact: true }).click();
				await expect(card.getByRole("button", { name: "Re-run", exact: true })).toBeEnabled({ timeout: 600_000 });
				await expectSuccessfulSteps(card, remoteTerminalStepLabels(corpName));
				await expect(connectionInput(card, "WEBPUBSUB_CLIENT_ID")).toHaveValue(clientId);
				await expect(card.getByRole("button", { name: /^Save variables?$/ })).toBeDisabled({ timeout: 60_000 });
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
				await expectSnapshot(page, card, testInfo, "draft-restored", viewportName);
			});
		});

		test("Requires authentication before creating relay resources", async ({ page }, testInfo) => {
			await page.goto(CORP_URL);
			const card = page.locator("#card-remote_terminal_infra");
			await card.getByText("Private Zeninstaller Environment", { exact: true }).click();
			await expect(card.getByText("Sign in to Azure", { exact: true })).toBeVisible();
			await expect(card.getByRole("button", { name: /Create terminal relay|Re-run/ })).toHaveCount(0);
			await expectSnapshot(page, card, testInfo, "authentication-required", viewportName);
		});
	});
}