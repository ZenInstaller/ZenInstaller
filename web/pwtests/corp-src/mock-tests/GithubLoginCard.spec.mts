// UI component: ../../../corp-src/cards/GithubLoginCard.tsx
import { expect, test } from "@playwright/test";
import { CORP_URL, viewports } from "../../testInit";
import { expectSnapshot } from "../../util/testHelper.ts";
import { installMockGitHub } from "../util/mockTestHelper.mts";
import { expandGithubLoginCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`GitHub Login Card Mock - ${viewportName}`, () => {
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
			await page.goto(CORP_URL);
			const card = await test.step("Expand unauthenticated card", async () => {
				const result = await expandGithubLoginCard(page);
				await expectSnapshot(page, result, testInfo, "start", viewportName);
				return result;
			});

			await test.step("Shows authenticated GitHub card after login", async () => {
				await installMockGitHub(page, context);
				await context.addInitScript(() => {
					sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "direct", token: "ghp_mock" }));
				});
				await page.reload();
				await expect(card.getByText(/Authenticated as/i)).toBeVisible();
				await expect(card.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
				await expectSnapshot(page, card, testInfo, "end", viewportName);
			});
		});

		test("Rejects an invalid PAT", async ({ page }, testInfo) => {
			await page.goto(CORP_URL);
			const card = await expandGithubLoginCard(page);
			await card.getByRole("button", { name: "Direct (PAT)", exact: true }).click();
			const input = card.getByPlaceholder("ghp_… or github_pat_…");
			await expect(card.getByRole("button", { name: "Connect with PAT", exact: true })).toBeDisabled();
			await input.fill("not-a-valid-pat");
			await card.getByRole("button", { name: "Connect with PAT", exact: true }).click();
			await expect(card.getByText(/Must be a GitHub PAT/i)).toBeVisible();
			await expectSnapshot(page, card, testInfo, "invalid-pat", viewportName);
		});

		test("Switches from direct mode back to backend mode", async ({ page }) => {
			await page.goto(CORP_URL);
			const card = await expandGithubLoginCard(page);
			await card.getByRole("button", { name: "Direct (PAT)", exact: true }).click();
			await card.getByRole("button", { name: "Backend", exact: true }).click();
			await expect(card.getByRole("button", { name: "Login with GitHub", exact: true })).toBeVisible();
		});
	});
}
