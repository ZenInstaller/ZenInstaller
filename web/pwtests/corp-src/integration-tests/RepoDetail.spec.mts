// UI component: ../../../corp-src/cards/RepoDetail.tsx
import { expect, test } from "@playwright/test";
import { restoreGithubSessionStorage } from "../util/setupHelper.mts";
import { CORP_URL, TEST_REPO_FROM_PROD, TEST_REPO_MAIN, TEST_REPO_NO_ENV, viewports, } from "../../testInit";
import { checkRepoExists, chooseExistingRepo, createNewRepo } from "../util/testHelper.mts";
import { expectSnapshot, safePathSegment, expectVisibleWithin, waitForLocatorContentLoaded } from "../../util/testHelper.ts";
import { expandRepoCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`RepoDetail Integrated - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1});

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
			test.setTimeout(300_000);			
			const repoName = safePathSegment(`${TEST_REPO_MAIN}-${viewportName}`,);
			await restoreGithubSessionStorage(context);
			await page.goto(CORP_URL);
			
			const repoCard = await test.step("Expand the Repo Detail Card", async() => {
				const repoCard = await expandRepoCard(page);
				return repoCard;
			})

			await test.step("Create the repository if it does not exist", async (step) => {
				const repoExists = await checkRepoExists(page, repoCard, repoName);
				if (repoExists) {
					console.log(`Repository "${repoName}" already exists; skipping creation.`);
					step.skip(repoExists, `Repository "${repoName}" already exists; skipping creation.`);
				}
				await createNewRepo(page, repoCard, repoName);
			});

			await test.step("Select the existing repository", async (step) => {
				await chooseExistingRepo(page, repoCard, repoName);
			});

			await test.step("Creates new PROD branch from main", async () => {
				const PROD = repoCard.getByText("PROD", { exact: true });
				const TEST = repoCard.getByText("TEST", { exact: true });
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				await expectVisibleWithin(PROD, "PROD environment", 50_000);
				await expectVisibleWithin(TEST, "TEST environment", 50_000);

				await PROD.click();
				const missingProdBranch = repoCard.getByText(/^No branch found matching environment "PROD"\.$/);
				if (await missingProdBranch.isVisible()) {
					const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD", });
					await expectVisibleWithin(createProdButton, "Button: Create New Branch: PROD", 50_000);
					await createProdButton.click();
					await expect(createProdButton).toBeHidden({ timeout: 50_000, });
					await expect(missingProdBranch).toHaveCount(0);
				}
				await expect(repoCard.getByText("Failed to create branch", { exact: true, }),).toHaveCount(0);

				await expectSnapshot(page, repoCard, testInfo, "prod-cloned", viewportName);

			});

			await test.step("Creates new TEST branch from main", async () => {
				const PROD = repoCard.getByText("PROD", { exact: true });
				const TEST = repoCard.getByText("TEST", { exact: true });
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				await expectVisibleWithin(PROD, "PROD environment", 50_000);
				await expectVisibleWithin(TEST, "TEST environment", 50_000);

				await TEST.click();
				const missingTestBranch = repoCard.getByText(/^No branch found matching environment "TEST"\.$/);
				if (await missingTestBranch.isVisible()) {
					const createTestButton = repoCard.getByRole("button", { name: "Create New Branch: TEST", });
					await expectVisibleWithin(createTestButton, "Button: Create New Branch: TEST", 50_000);
					await createTestButton.click();
					await expect(createTestButton).toBeHidden({ timeout: 30_000, });
					await expect(missingTestBranch).toHaveCount(0);
				}
				await expect(repoCard.getByText("Failed to create branch", { exact: true, }),).toHaveCount(0);

				await expectSnapshot(page, repoCard, testInfo, "end", viewportName);
			});
				
		});


		test("Edge Integrated - Creates valid repo with no environments", async ({ page, context}, testInfo) => {
			await restoreGithubSessionStorage(context);
			await page.goto(CORP_URL);
			const reponame = safePathSegment(`${TEST_REPO_NO_ENV}-${viewportName}`);
			const repoCard = await expandRepoCard(page,);
			const repoExists = await checkRepoExists(page, repoCard, reponame);
			if (repoExists) {
				await chooseExistingRepo(page, repoCard, reponame);
			}

			if (!repoExists) {
				const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name...", });
				await repoInput.click();
				await waitForLocatorContentLoaded(page.getByRole("option",), "No options", "Repo list", 5000000);
				await repoInput.fill(reponame);
				const escapedRepoName = reponame.replace(/[.*+?^${}()|[\]\\]/g, "\\$&",);
				const alreadyClonedOption = page.getByRole("option", { name: new RegExp(`^(?:▪\\s*)?${escapedRepoName}$`, "i",), });
				const cloneOption = page.getByRole("option", { name: new RegExp(`^Clone as [\"'“‘]${escapedRepoName}[\"'”’]$`,), });
				
				await expectVisibleWithin(alreadyClonedOption.or(cloneOption), "Existing repo or clone option", 50_000);
				if (await alreadyClonedOption.isVisible()) {
					throw new Error(`The repo "${reponame}" already exists. Please delete it from your GitHub account before running this test.`);
				}
				
				await expectVisibleWithin(cloneOption, `Clone as ${reponame}`, 50_000);
				await cloneOption.click();
				// Confirm the option click changed the application's state.
				await expect(cloneOption).toBeHidden();
				await expect(repoInput).toHaveAttribute("aria-expanded", "false");
				await expectVisibleWithin(repoCard.getByText("Clone from template",), "Clone from template", 50_000);
				const createEnvironmentsSwitch = repoCard.getByRole("switch", { name: "Create environments", });
				await expect(createEnvironmentsSwitch).toBeChecked();
				await createEnvironmentsSwitch.click();
				await expect(createEnvironmentsSwitch).not.toBeChecked();

				const cloneRepoButton = repoCard.getByRole("button", { name: "Clone Repository", });
				await cloneRepoButton.click();
			}

			await expect(repoCard.getByText("Loading environments...", { exact: true, })).toBeHidden();
			await expectVisibleWithin(repoCard.getByText("Valid", { exact: true, }), "Repository validation", 50_000);
			await expectVisibleWithin(repoCard.getByText("No environment found",), "No environment message", 50_000);
			await expect(repoCard.getByRole("button", { name: "Clone Repository", })).toHaveCount(0);

			await expectSnapshot(page, repoCard, testInfo, "repo-no-env", viewportName);
		});

		test("Edge Integrated - Creates PROD branch, then creates TEST from PROD", async ({ page, context}, testInfo) => {
			test.setTimeout(300_000);
			const repoName = safePathSegment(`${TEST_REPO_FROM_PROD}-${viewportName}`,);
			await restoreGithubSessionStorage(context);
			await page.goto(CORP_URL);
			const repoCard = await expandRepoCard(page,);
			const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name...", });

			await createNewRepo(page, repoCard, repoName);
			await expect(repoInput).toHaveValue(repoName);
			const PROD = repoCard.getByText("PROD", { exact: true, });
			const TEST = repoCard.getByText("TEST", { exact: true, });
			await expect(repoCard.getByText("Loading environments...", { exact: true, })).toBeHidden();
			await expectVisibleWithin(PROD, "PROD environment", 50_000);
			await expectVisibleWithin(TEST, "TEST environment", 50_000);

			await PROD.click();
			const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD", });
			await expectVisibleWithin(createProdButton, "Create PROD branch button", 50_000);
			await createProdButton.click();
			await expect(repoCard.getByText(/^No branch found matching environment "PROD"\.$/),).toHaveCount(0);

			await TEST.click();
			const createTestButton = repoCard.getByRole("button", { name: "Create New Branch: TEST", });
			await expectVisibleWithin(createTestButton, "Create TEST branch button", 50_000);
			const sourceBranchSelect = createTestButton.locator("..").getByRole("combobox",);
			await sourceBranchSelect.click();
			await page.getByRole("option", { name: "PROD", exact: true, }).click();
			await expect(sourceBranchSelect).toHaveText(/PROD/);

			await expectSnapshot(page, repoCard, testInfo, "prod-from-test-branch", viewportName);

			await createTestButton.click();
			await expect(createTestButton).toBeHidden({ timeout: 50_000, });
			await expect(repoCard.getByText(/^No branch found matching environment "TEST"\.$/),).toHaveCount(0);

			await expectSnapshot(page, repoCard, testInfo, "prod-from-test-cloned", viewportName);
		});
	});
}


