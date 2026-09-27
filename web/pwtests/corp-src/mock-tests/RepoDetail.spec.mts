// UI component: ../../../corp-src/cards/RepoDetail.tsx
import { expect, test } from "@playwright/test";
import { CORP_URL, GITHUB_API_URL, GITHUB_API_URL_REGEX, viewports, } from "../../testInit";
import { createNewRepo } from "../util/testHelper.mts";
import { expectSnapshot, expectVisibleWithin, logMockAPI } from "../../util/testHelper.ts";
import { installMockGitHub } from "../util/mockTestHelper.mts";
import { expandRepoCard } from "../util/cardHelper.mts";
import { writeFile } from "fs/promises";

for (const [viewportName, viewport] of Object.entries(viewports)) {
	test.describe(`Mock Tests - ${viewportName}`, () => {
		test.use({ viewport, deviceScaleFactor: 1});
		
		test.beforeEach(async ({ page, context, }) => {
			// blocks unexpected POST requests (supposed to be mocked)
			await page.coverage.startJSCoverage({ resetOnNavigation: false, });
			await page.route(`${GITHUB_API_URL}/**`, async (route) => {
				const request = route.request();
				if (["GET", "HEAD", "OPTIONS"].includes(request.method())) {
					await route.continue();
					return;
				}
				console.info(`Blocked unexpected GitHub write: ${request.method()} ${request.url()}`,);
				await route.abort("blockedbyclient");
			});
			await installMockGitHub(page, context);
			await page.goto(CORP_URL);
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

		test("Happy path", async ({ page, }, testInfo) => {
			const newRepoName = `mock-clone-test-${viewportName.toLowerCase()}`;
			const newRepoId = 987654322;
			const mainSha = "main-commit-sha";
			const prodSha = "prod-commit-sha";
			const createdBranches: Array<{ ref: string; sha: string }> = [];
			const environments = [
				{ name: "PROD", id: 1001, url: `${GITHUB_API_URL}/repos/mock-owner/${newRepoName}/environments/PROD`, },
				{ name: "TEST", id: 1002, url: `${GITHUB_API_URL}/repos/mock-owner/${newRepoName}/environments/TEST`, },
			];

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,),
				async (route) => {
					const ownerType = route.request().url().includes("/orgs/") ? "Organization" : "User";
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify([{ id: 111111, name: "existing-unrelated-repo", owner: { type: ownerType, }, },]),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/ZenMe-AU/ZenbloxCore/generate(?:\\?.*)?$`,),
				async (route) => {
					expect(route.request().postDataJSON()).toMatchObject({
						name: newRepoName,
						private: true,
						include_all_branches: false,
					});
					await logMockAPI(page, route, 201, { id: newRepoId, name: newRepoName, });
					await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: newRepoId, name: newRepoName, }), });
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}/environments/(?:PROD|TEST)(?:\\?.*)?$`,),
				async (route) => {
					await logMockAPI(page, route, 200, {});
					await route.fulfill({ status: 200, contentType: "application/json", body: "{}", });
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}/environments(?:\\?.*)?$`,),
				async (route) => {
					const body = { total_count: environments.length, environments, };
					await logMockAPI(page, route, 200, body);
					await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), });
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}/branches(?:\\?.*)?$`,),
				async (route) => {
					const branches = [
						{ name: "main", commit: { sha: mainSha }, protected: true },
						...createdBranches.map(({ ref, sha }) => ({
							name: ref.replace("refs/heads/", ""),
							commit: { sha },
							protected: false,
						})),
					];
					await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(branches) });
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}/git/ref/heads/(?:main|PROD)(?:\\?.*)?$`,),
				async (route) => {
					const sourceSha = route.request().url().includes("/heads/PROD") ? prodSha : mainSha;
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({ object: { sha: sourceSha } }),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}/git/refs(?:\\?.*)?$`,),
				async (route) => {
					const branch = route.request().postDataJSON() as { ref: string; sha: string };
					createdBranches.push(branch);
					await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${newRepoName}(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							id: newRepoId,
							name: newRepoName,
							template_repository: { full_name: "ZenMe-AU/ZenbloxCore", },
						}),
					});
				},
			);

			const mockedReposLoaded = page.waitForResponse((response) => response.ok()
				&& new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,).test(response.url()),);
			await page.reload();
			await mockedReposLoaded;

			const repoCard = await test.step("Expand RepoDetail Card", async () => {
				const repoCard = await expandRepoCard(page);
				return repoCard;
			});

			await test.step("Typing the new repository name in the textbox", async () => {
				await expectSnapshot(page, repoCard, testInfo, "start", viewportName);
				await createNewRepo(page, repoCard, newRepoName);
				await expectSnapshot(page, repoCard, testInfo, "typed-repo", viewportName);
			});

			await test.step("Verify the cloned repository environments", async () => {
				await expectVisibleWithin(repoCard.getByText("Pick the environment to configure."),"Text: Pick the environment to configure", 500_000);
				const PROD = repoCard.getByText("PROD", { exact: true });
				const TEST = repoCard.getByText("TEST", { exact: true });
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				await expect(PROD).toBeVisible();
				await expect(TEST).toBeVisible();
				await expectSnapshot(page, repoCard, testInfo, "cloned-repo", viewportName);
			});

			await test.step("Creates new PROD branch from main", async () => {
				const PROD = repoCard.getByText("PROD", { exact: true });
				const TEST = repoCard.getByText("TEST", { exact: true });
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				await expect(PROD).toBeVisible();
				await expect(TEST).toBeVisible();
				await PROD.click();
				const missingProdBranch = repoCard.getByText(/^No branch found matching environment "PROD"\.$/);
				await expect(missingProdBranch).toBeVisible();
				const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
				await expectVisibleWithin(createProdButton, "Button: Create New Branch: PROD", 30_000);
				await createProdButton.click();
				await expect.poll(() => createdBranches).toEqual([{ ref: "refs/heads/PROD", sha: mainSha }]);
				await expect(createProdButton).toBeHidden();
				await expect(missingProdBranch).toHaveCount(0);
				await expectSnapshot(page, repoCard, testInfo, "prod-cloned", viewportName);
			});

			await test.step("Creates new TEST branch from main", async () => {
				const PROD = repoCard.getByText("PROD", { exact: true });
				const TEST = repoCard.getByText("TEST", { exact: true });
				await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
				await expect(PROD).toBeVisible();
				await expect(TEST).toBeVisible();
				await TEST.click();
				const missingTestBranch = repoCard.getByText(/^No branch found matching environment "TEST"\.$/);
				await expect(missingTestBranch).toBeVisible();
				const createTestButton = repoCard.getByRole("button", { name: "Create New Branch: TEST" });
				await expectVisibleWithin(createTestButton, "Button: Create New Branch: TEST", 30_000);
				const sourceBranchSelect = createTestButton.locator("..").getByRole("combobox");
				await sourceBranchSelect.click();
				await page.getByRole("option", { name: "PROD", exact: true }).click();
				await expect(sourceBranchSelect).toHaveText(/PROD/);
				await createTestButton.click();
				await expect.poll(() => createdBranches).toEqual([
					{ ref: "refs/heads/PROD", sha: mainSha },
					{ ref: "refs/heads/TEST", sha: prodSha },
				]);
				await expect(createTestButton).toBeHidden({ timeout: 30_000, });
				await expect(missingTestBranch).toHaveCount(0);
				await expect(repoCard.getByText("Failed to create branch", { exact: true, }),).toHaveCount(0);
				await expectSnapshot(page, repoCard, testInfo, "end", viewportName);
			});
		});

		test("Selecting valid repo with no environments", async ({ page, }, testInfo) => {
			const validRepoName = "valid-repo-no-env";
			const validRepoId = 987654323;
			const repoListPattern = new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,);

			await page.route(repoListPattern, async (route) => {
				const ownerType = route.request().url().includes("/orgs/") ? "Organization" : "User";
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([{ id: validRepoId, name: validRepoName, owner: { type: ownerType, }, },]),
				});
			});

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${validRepoName}(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							id: validRepoId,
							name: validRepoName,
							template_repository: { full_name: "ZenMe-AU/ZenbloxCore", },
						}),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${validRepoName}/branches(?:\\?.*)?$`,),
				async (route) => { await route.fulfill({ status: 200, contentType: "application/json", body: "[]", }); },
			);

			// mock valid repo but no environment 
			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${validRepoName}/environments(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({ total_count: 0, environments: [], }),
					});
				},
			);

			const mockedReposLoaded = page.waitForResponse((response) => response.ok() && repoListPattern.test(response.url()),);
			await page.reload();
			await mockedReposLoaded;

			const repoCard = await expandRepoCard(page,);
			const cloneRepoButton = repoCard.getByRole("combobox", { name: "Select or type repo name...", });
			await cloneRepoButton.click();
			await page.getByRole("option", { name: validRepoName, }).click();

			await expect(cloneRepoButton).toHaveValue(validRepoName);
			await expect(repoCard.getByText("Loading environments...", { exact: true, })).toBeHidden();
			await expect(repoCard.getByText("Valid", { exact: true, })).toBeVisible({ timeout: 30_000, });
			await expect(repoCard.getByText("No environment found",)).toBeVisible();
			await expect(repoCard.getByRole("button", { name: "Clone Repository", })).toHaveCount(0);

			await expectSnapshot(page, repoCard, testInfo, "valid-repo-no-env-mock", viewportName);
		});

		test("Shows an error when cloning the template fails", async ({ page, }, testInfo) => {
			const repoName = `mock-clone-failure-${viewportName.toLowerCase()}`;
			let cloneRequests = 0;
			await page.route(`${GITHUB_API_URL}/repos/ZenMe-AU/ZenbloxCore/generate`, async (route) => {
				cloneRequests++;
				expect(route.request().method()).toBe("POST");
				expect(route.request().postDataJSON()).toMatchObject({
					name: repoName,
					private: true,
					include_all_branches: false,
				});
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ message: "Mock template generation failure" }),
				});
			});

			const repoCard = await expandRepoCard(page);
			const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name..." });
			await repoInput.click();
			await repoInput.fill(repoName);
			const cloneOption = page.getByRole("option", {
				name: new RegExp(`^Clone as ["'“‘]${repoName}["'”’]$`),
			});
			await expect(cloneOption).toBeVisible();
			await cloneOption.click();
			await expect(cloneOption).toBeHidden();

			const cloneButton = repoCard.getByRole("button", { name: "Clone Repository" });
			await cloneButton.click();
			await expect(repoCard.getByText("Clone failed", { exact: true })).toBeVisible();
			await expect(cloneButton).toBeEnabled();
			expect(cloneRequests).toBe(1);
			await expectSnapshot(page, repoCard, testInfo, "clone-failed", viewportName);
		});

		test("Creates PROD branch, then creates TEST from PROD", async ({ page, }, testInfo) => {
			const repoName = "mock-branch-test";
			const repoId = 987654324;
			const mainSha = "main-commit-sha";
			const prodSha = "prod-commit-sha";
			const repoListPattern = new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,);
			const createdBranches: Array<{ ref: string; sha: string }> = [];

			await page.route(repoListPattern, async (route) => {
				const ownerType = route.request().url().includes("/orgs/") ? "Organization" : "User";
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([{ id: repoId, name: repoName, owner: { type: ownerType, }, },]),
				});
			});

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${repoName}(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							id: repoId,
							name: repoName,
							template_repository: { full_name: "ZenMe-AU/ZenbloxCore", },
						}),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${repoName}/branches(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify([{ name: "main", commit: { sha: mainSha, }, protected: true, },]),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${repoName}/environments(?:\\?.*)?$`,),
				async (route) => {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							total_count: 2,
							environments: [
								{ name: "PROD", id: 1001, url: `${GITHUB_API_URL}/repos/mock-owner/${repoName}/environments/PROD`, },
								{ name: "TEST", id: 1002, url: `${GITHUB_API_URL}/repos/mock-owner/${repoName}/environments/TEST`, },
							],
						}),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${repoName}/git/ref/heads/(?:main|PROD)(?:\\?.*)?$`,),
				async (route) => {
					const sourceSha = route.request().url().includes("/heads/PROD") ? prodSha : mainSha;
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({ object: { sha: sourceSha, }, }),
					});
				},
			);

			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${repoName}/git/refs(?:\\?.*)?$`,),
				async (route) => {
					createdBranches.push(route.request().postDataJSON() as { ref: string; sha: string });
					await route.fulfill({ status: 201, contentType: "application/json", body: "{}", });
				},
			);

			const mockedReposLoaded = page.waitForResponse((response) => response.ok() && repoListPattern.test(response.url()),);
			await page.reload();
			await mockedReposLoaded;

			const repoCard = await expandRepoCard(page,);
			const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name...", });
			await repoInput.click();
			await page.getByRole("option", { name: repoName, }).click();
			await expect(repoCard.getByText("Valid", { exact: true, })).toBeVisible();

			await repoCard.getByText("PROD", { exact: true, }).click();
			const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD", });
			await expect(createProdButton).toBeVisible();
			await createProdButton.click();
			await expect.poll(() => createdBranches,).toEqual([{ ref: "refs/heads/PROD", sha: mainSha, },]);
			await expect(createProdButton).toBeHidden();

			await expectSnapshot(page, repoCard, testInfo, "prod-branch-created-mock", viewportName);

			await repoCard.getByText("TEST", { exact: true, }).click();
			const createTestButton = repoCard.getByRole("button", { name: "Create New Branch: TEST", });
			await expect(createTestButton).toBeVisible();
			const sourceBranchSelect = createTestButton.locator("..").getByRole("combobox",);
			await sourceBranchSelect.click();
			await page.getByRole("option", { name: "PROD", exact: true, }).click();
			await expect(sourceBranchSelect).toHaveText(/PROD/);

			await expectSnapshot(page, repoCard, testInfo, "prod-branch-visible-mock", viewportName);

			await createTestButton.click();

			await expect.poll(() => createdBranches,).toEqual([
				{ ref: "refs/heads/PROD", sha: mainSha, },
				{ ref: "refs/heads/TEST", sha: prodSha, },
			]);
			await expect(createTestButton).toBeHidden();
			await expect(repoCard.getByText(/^No branch found matching environment "TEST"\.$/),).toHaveCount(0);

			await expectSnapshot(page, repoCard, testInfo, "test-branch-created-mock", viewportName);
		});

		test("Selecting repo not a clone of source repo", async ({ page, }, testInfo) => {
			const invalidRepoName = "playwright-invalid-template-repo";
			const invalidRepoId = 987654321;

			// Mock the repository list for either a user or organisation account.
			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,),
				async (route) => {
					const ownerType = route.request().url().includes("/orgs/") ? "Organization" : "User";
					const mockResponseData = JSON.stringify([{ id: invalidRepoId, name: invalidRepoName, owner: { type: ownerType, }, },]);
					logMockAPI(page, route, 200, mockResponseData);
					await route.fulfill({ status: 200, contentType: "application/json", body: mockResponseData, });
				},
			);

			// The repository exists, but it was not created from the required template.
			await page.route(new RegExp(`${GITHUB_API_URL_REGEX}/repos/[^/]+/${invalidRepoName}(?:\\?.*)?$`,),
				async (route) => {
					const mockResponseData = JSON.stringify([{ id: invalidRepoId, name: invalidRepoName, owner: { type: "User", }, },]);
					logMockAPI(page, route, 200, mockResponseData);
					await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: invalidRepoId, name: invalidRepoName, template_repository: null, }), });
				},
			);

			// Start waiting before reloading so the mocked response is not missed.
			const mockedReposLoaded = page.waitForResponse((response) => response.ok()
				&& new RegExp(`${GITHUB_API_URL_REGEX}/(?:user/repos|orgs/[^/]+/repos)(?:\\?.*)?$`,).test(response.url()),);
			await page.reload();
			await mockedReposLoaded;
			const repoCard = await expandRepoCard(page);
			const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name...", })
			await repoInput.click();
			const invalidRepoOption = page.getByRole("option", { name: invalidRepoName, });
			await expect(invalidRepoOption).toBeVisible();
			await invalidRepoOption.click();
			await expect(repoInput).toHaveValue(invalidRepoName);
			await expect(repoInput).toHaveAttribute("aria-expanded", "false");
			await expect(repoCard.getByText("Not a clone", { exact: true, })).toBeVisible();
			await expect(repoCard.getByText("This repo is not a clone of the template. Only repos cloned from ZenMe-AU/ZenbloxCore can be used.")).toBeVisible();
			await expectVisibleWithin(repoCard.getByText('No environment found'), "Text: No environment found.", 500000);
			await expect(repoCard.getByText("No environment found")).toBeVisible();

			await expectSnapshot(page, repoCard, testInfo, "invalid-repo-mock", viewportName);
		});

	});
}
