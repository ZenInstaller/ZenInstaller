// UI component: ../../../corp-src/cards/GithubLoginCard.tsx
import { expect, test } from "@playwright/test";
import { getCorpGithubAuthMode, restoreGithubSessionStorage } from "../util/setupHelper.mts";
import { CORP_URL, viewports, } from "../../testInit";
import { expectSnapshot, expectVisibleWithin } from "../../util/testHelper.ts";
import { expandGithubLoginCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`GitHub Login Card - ${viewportName}`, () => {
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
		
		test("Happy path", async ({ page, context, }, testInfo) => {
			await page.goto(CORP_URL);
			
			const githubCard = await test.step("Expand Unauthenticated Github Login Card", async () => {
				const githubCard = await expandGithubLoginCard(page,);
				await expect(githubCard.getByRole("button", { name: "Login with GitHub" })).toBeVisible();
				await expectSnapshot(page, githubCard, testInfo, "start", viewportName);
				return githubCard;
			});
			
			await test.step("Shows authenticated GitHub card after login", async () => {
				await restoreGithubSessionStorage(context,);
				await page.reload();

				const authMode = getCorpGithubAuthMode();
				expect(authMode,).not.toBeNull();
				const githubCard = await expandGithubLoginCard(page,);
				await expectVisibleWithin(githubCard.getByText(/Authenticated as/i,), "GitHub authenticated status", 50_000);
				const patMode = githubCard.getByText(/· PAT mode/i,);
				if (authMode === "direct") {
					await expectVisibleWithin(patMode, "PAT mode indicator", 50_000);
				} else {
					await expect(patMode,).toHaveCount(0);
				}
				await expectVisibleWithin(githubCard.getByRole("button", { name: "Sign out", exact: true, }), "Sign out button", 50_000);
				await expect(githubCard.getByRole("button", { name: "Login with GitHub", exact: true, }),).toHaveCount(0);
				await expectSnapshot(page, githubCard, testInfo, "end", viewportName);
			});

		});


		test("Testing invalid PAT token in direct (PAT) mode", async ({ page }, testInfo) => {
			await page.goto(CORP_URL);
			const githubCard = await expandGithubLoginCard(page,);
			await githubCard.getByRole("button", { name: "Direct (PAT)", exact: true, }).click();
			const patInput = githubCard.getByPlaceholder("ghp_… or github_pat_…",);
			const connectWithPat = githubCard.getByRole("button", { name: "Connect with PAT", exact: true, });
			await expectVisibleWithin(patInput, "GitHub PAT input", 50_000);
			await expect(connectWithPat,).toBeDisabled();
			await patInput.fill("not-a-valid-pat",);
			await expect(connectWithPat,).toBeEnabled();
			await connectWithPat.click();
			await expectVisibleWithin(githubCard.getByText(/Must be a GitHub PAT \(ghp_… or github_pat_…\)/i,), "Invalid GitHub PAT message", 50_000);
			await expectSnapshot(page, githubCard, testInfo, "invalid-pat", viewportName);
		});

		test("Can switch from Direct mode back to Backend mode", async ({ page, context }) => {
			await page.goto(CORP_URL);
			const githubCard = await expandGithubLoginCard(page,);
			await githubCard.getByRole("button", { name: "Direct (PAT)", exact: true, }).click();
			await expectVisibleWithin(githubCard.getByRole("button", { name: "Connect with PAT", exact: true, }), "Connect with PAT button", 50_000);
			await githubCard.getByRole("button", { name: "Backend", exact: true, }).click();
			await expectVisibleWithin(githubCard.getByRole("button", { name: "Login with GitHub", exact: true, }), "Login with GitHub button", 50_000);
		});

	});
}
