/// <reference types="node" />
// UI component: ../../../corp-src/cards/BackendDeployCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { backendStepLabels, openBackendCard } from "../util/BackendDeployCardHelper.mts";
import { backendBuild, prepareMockBackend } from "../util/BackendDeployCardMockHelper.mts";
import { expectSuccessfulSteps } from "../util/mockTestHelper.mts";
import { installRelayNetworkGuard } from "../util/RemoteTerminalInfraCardMockHelper.mts";

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
	test.describe(`Backend Deploy Card Mock - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });
		test("Happy path", async ({ page, context }, testInfo) => {
			test.setTimeout(180_000);
			const { card, state, github, initialVariables, unexpectedRequests } = await prepareMockBackend(page, context, viewportName);
			await expect(card.getByText(/^Latest build:/)).toContainText("none yet");
			await expect(card.getByText(/^Live on the app:/)).toContainText("nothing deployed");
			await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
			await expectSnapshot(page, card, testInfo, "start", viewportName);
			await test.step("Build the backend using the existing PROD environment", async () => {
				await card.getByRole("button", { name: "Build", exact: true }).click();
				await expect(card.getByRole("button", { name: "Building...", exact: true })).toBeDisabled();
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
				await expect.poll(() => state.dispatches.length).toBe(1);
				await page.clock.fastForward(30_001);
				await expect(card.getByRole("button", { name: "Build", exact: true })).toBeEnabled();
				await expect(card.getByText(/^Latest build:/)).toContainText("abcdef1");
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeEnabled();
				expect(state.dispatches).toEqual([{ ref: "PROD", inputs: { github_env_name: "PROD" } }]);
				await expectSnapshot(page, card, testInfo, "built", viewportName);
			});
			await test.step("Deploy the built package to the existing Function App", async () => {
				await card.getByRole("button", { name: "Deploy", exact: true }).click();
				await expect.poll(() => state.uploads).toBe(1);
				await expect(card.getByRole("button", { name: "Build", exact: true })).toBeDisabled();
				await expect(card.getByRole("button", { name: "Deploying...", exact: true })).toBeDisabled();
				await page.clock.fastForward(5_001);
				await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible();
				await expectSuccessfulSteps(card, backendStepLabels("pwtests-terminal-app"));
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
				expect(state.downloads).toBe(1);
				expect(state.settingsWrites).toBe(1);
				expect(state.settings).toEqual({
					ALLOWED_ORIGINS: new URL(CORP_URL).origin, SESSION_TABLE_NAME: "sessions",
					WEBPUBSUB_ENDPOINT: "pwtests-wpubsub.webpubsub.azure.com",
					BACKEND_VERSION: backendBuild.version, BACKEND_SHA: backendBuild.sha, BACKEND_BUILT_AT: String(backendBuild.builtAt),
				});
				await expectSnapshot(page, card, testInfo, "deployed", viewportName);
			});
			await test.step("Read back the deployed version after reload", async () => {
				await page.reload();
				await openBackendCard(page);
				await expect(card.getByText(/^Live on the app:/)).toContainText("abcdef1");
				await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible();
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
				expect(state.uploads).toBe(1);
				expect(github.variables).toEqual(initialVariables);
				await expectSnapshot(page, card, testInfo, "persisted", viewportName);
			});
			expect(unexpectedRequests, "No unmocked external calls or prerequisite writes").toEqual([]);
		});
		test("Reports a missing package without deploying", async ({ page, context }, testInfo) => {
			const { card, state, unexpectedRequests } = await prepareMockBackend(page, context, viewportName, { missingArtifact: true });
			await card.getByRole("button", { name: "Deploy", exact: true }).click();
			await expect(card.getByText("The latest build did not publish a package artifact.", { exact: true })).toBeVisible();
			expect(state.uploads).toBe(0);
			expect(state.settingsWrites).toBe(0);
			await expectSnapshot(page, card, testInfo, "missing-package", viewportName);
			expect(unexpectedRequests).toEqual([]);
		});
		test("Reports a build permission failure", async ({ page, context }, testInfo) => {
			const { card, state, unexpectedRequests } = await prepareMockBackend(page, context, viewportName, { failBuild: true });
			await card.getByRole("button", { name: "Build", exact: true }).click();
			await expect(card.getByText("Failed to trigger workflow: 403", { exact: true })).toBeVisible();
			await expect(card.getByRole("button", { name: "Build", exact: true })).toBeEnabled();
			await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
			expect(state.uploads).toBe(0);
			await expectSnapshot(page, card, testInfo, "build-failed", viewportName);
			expect(unexpectedRequests).toEqual([]);
		});
		test("Retries a failed upload without changing connection variables", async ({ page, context }, testInfo) => {
			const { card, state, github, initialVariables, unexpectedRequests } =
				await prepareMockBackend(page, context, viewportName, { failUploadOnce: true });
			await card.getByRole("button", { name: "Deploy", exact: true }).click();
			await expect(card.locator('p:not([data-sensitive="true"])').filter({
				hasText: /^Deploying the package failed: 500 Mock upload failure$/,
			})).toBeVisible();
			expect(state.settingsWrites).toBe(0);
			await card.getByRole("button", { name: "Deploy", exact: true }).click();
			await expect.poll(() => state.uploads).toBe(2);
			await expect(card.getByRole("button", { name: "Deploying...", exact: true })).toBeDisabled();
			await page.clock.fastForward(5_001);
			await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible();
			await expectSuccessfulSteps(card, backendStepLabels("pwtests-terminal-app"));
			await expect(card.getByText(/Mock upload failure/)).toHaveCount(0);
			expect(state.settingsWrites).toBe(1);
			expect(github.variables).toEqual(initialVariables);
			await expectSnapshot(page, card, testInfo, "recovered", viewportName);
			expect(unexpectedRequests).toEqual([]);
		});
		test("Requires authentication before building or deploying", async ({ page, context }, testInfo) => {
			const unexpectedRequests = await installRelayNetworkGuard(context);
			await page.goto(CORP_URL);
			const card = page.locator("#card-backend_deploy");
			await card.getByText("Private Zeninstaller Backend", { exact: true }).click();
			await expect(card.getByText("Sign in to Azure", { exact: true })).toBeVisible();
			await expect(card.getByRole("button", { name: /^(Build|Deploy)$/ })).toHaveCount(0);
			await expectSnapshot(page, card, testInfo, "authentication-required", viewportName);
			expect(unexpectedRequests).toEqual([]);
		});
	});
}
