/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { expect, test as setup } from "@playwright/test";
import fs from "fs";
import { CORP_URL } from "../../testInit";
import { authDir, corpGithubAuthStateExists, saveGithubSessionStorage, githubStorageStateFile, githubSessionStorageFile } from "../util/setupHelper.mts";

const pat = process.env.GITHUB_TOKEN;
setup("Automatic GitHub PAT login for corp auth tests", async ({ page, context }) => {
  fs.mkdirSync(authDir, { recursive: true });

  if (corpGithubAuthStateExists("direct")) {
    console.log("GitHub PAT auth storage state already exists. Skipping PAT setup.");
    console.log(`Storage state: ${githubStorageStateFile}`);
    console.log(`Session storage: ${githubSessionStorageFile}`);
    return;
  }

  if (!pat) {
    throw new Error("GITHUB_TOKEN is missing or empty in web/pwtests/.env file.");
  }

  await page.goto(CORP_URL);
  const githubCard = page.locator("#card-github_login");
  const introText = githubCard.getByText(
    /Connect your GitHub account so ZenInstaller can create the repository, environment, and secrets needed to deploy Zenblox\./i
  );

  if (!(await introText.isVisible())) {
    await githubCard.getByText(/^GitHub login$/i).click();
  }
  await expect(introText).toBeVisible();
  await githubCard.getByRole("button", { name: "Direct (PAT)", exact: true }).click();
  const patInput = githubCard.getByPlaceholder("ghp_… or github_pat_…");
  await expect(patInput).toBeVisible();
  await patInput.fill(pat!);
  await githubCard.getByRole("button", { name: "Connect with PAT", exact: true }).click();
  await expect(githubCard.getByText(/Authenticated as/i)).toBeVisible({ timeout: 30_000 });

  // Need to save sessionStorage because Playwright storageState only saves cookies + localStorage
  await page.context().storageState({ path: githubStorageStateFile });
  await saveGithubSessionStorage(context);
  console.log(`Saved PAT auth storage state: ${githubStorageStateFile}`);
  console.log(`Saved PAT auth session storage: ${githubSessionStorageFile}`);
});
