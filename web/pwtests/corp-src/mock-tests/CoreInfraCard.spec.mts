import { expect, test } from "@playwright/test";
import { writeFile } from "fs/promises";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { installMockGitHub } from "../util/mockTestHelper.mts";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Core Infrastructure Card Mock - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1 });

		test.beforeEach(async ({ page, context }) => {
			await page.coverage.startJSCoverage({ resetOnNavigation: false });
			await installMockGitHub(page, context);
			await page.goto(CORP_URL);
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

		test("Shows prerequisites before infrastructure setup", async ({ page }, testInfo) => {
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