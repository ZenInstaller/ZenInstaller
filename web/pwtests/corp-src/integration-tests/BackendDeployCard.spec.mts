/// <reference types="node" />
// UI component: ../../../corp-src/cards/BackendDeployCard.tsx
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { backendStepLabels, openBackendCard, prepareExistingBackend } from "../util/BackendDeployCardHelper.mts";
import { expectSuccessfulSteps } from "../util/mockTestHelper.mts";

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
	test.describe(`Backend Deploy Card - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });
		test("Happy path", async ({ page, context }, testInfo) => {
			test.skip(process.env.RUN_BACKEND_DEPLOY_INTEGRATION !== "true",
				"Set RUN_BACKEND_DEPLOY_INTEGRATION=true only after approving live build and deployment.");
			test.setTimeout(1_200_000);
			const { card, appName } = await prepareExistingBackend(page, context, viewportName);
			await expectSnapshot(page, card, testInfo, "start", viewportName);
			await test.step("Build the backend using the existing PROD environment", async () => {
				await card.getByRole("button", { name: "Build", exact: true }).click();
				await expect(card.getByRole("button", { name: "Building...", exact: true })).toBeVisible();
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
				await expect(card.getByRole("button", { name: "Build", exact: true })).toBeEnabled({ timeout: 400_000 });
				await expect(card.getByText(/Latest build: none yet/)).toHaveCount(0);
				await expect(card.getByText(/Failed|taking longer than expected|Could not/i)).toHaveCount(0);
				await expectSnapshot(page, card, testInfo, "built", viewportName);
			});
			await test.step("Deploy the built package to the existing Function App", async () => {
				// A build of an unchanged commit may already be live.
				const deploy = card.getByRole("button", { name: "Deploy", exact: true });
				if (await deploy.isEnabled()) {
					await deploy.click();
					await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible({ timeout: 660_000 });
					await expectSuccessfulSteps(card, backendStepLabels(appName));
				}
				await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible();
				await expect(deploy).toBeDisabled();
				await expectSnapshot(page, card, testInfo, "deployed", viewportName);
			});
			await test.step("Read back the deployed version after reload", async () => {
				const latest = await card.getByText(/^Latest build:/).innerText();
				const sha = latest.match(/Latest build:\s*([0-9a-f]{7})/i)?.[1];
				if (!sha) throw new Error("The build did not expose its commit SHA.");
				await page.reload();
				await openBackendCard(page);
				await expect(card.getByText(/^Live on the app:/)).toContainText(sha);
				await expect(card.getByText("The Function App is running the latest build.", { exact: true })).toBeVisible();
				await expect(card.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
				await expectSnapshot(page, card, testInfo, "persisted", viewportName);
			});
		});
		test("Requires authentication before building or deploying", async ({ page }, testInfo) => {
			await page.goto(CORP_URL);
			const card = page.locator("#card-backend_deploy");
			await card.getByText("Private Zeninstaller Backend", { exact: true }).click();
			await expect(card.getByText("Sign in to Azure", { exact: true })).toBeVisible();
			await expect(card.getByRole("button", { name: /^(Build|Deploy)$/ })).toHaveCount(0);
			await expectSnapshot(page, card, testInfo, "authentication-required", viewportName);
		});
	});
}
