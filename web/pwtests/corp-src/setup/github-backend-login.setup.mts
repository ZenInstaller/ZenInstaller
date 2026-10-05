/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { expect, test as setup } from "@playwright/test";
import fs from "fs";
import { CORP_URL } from "../../testInit";
import { authDir, corpGithubAuthStateExists, githubStorageStateFile, githubSessionStorageFile, saveGithubSessionStorage } from "../util/setupHelper.mts";

setup("Manual GitHub OAuth login for corp auth tests", async ({ page, context }) => {
  fs.mkdirSync(authDir, { recursive: true });

  if (corpGithubAuthStateExists("backend")) {
    console.log("GitHub storage state already exists. Skipping manual setup.");
    console.log(`Saved storage state: ${githubStorageStateFile}`);
    console.log(`Session storage: ${githubSessionStorageFile}`);
    return;
  }

  await page.goto(CORP_URL);
  const githubCard = page.locator("#card-github_login");
  const loginButton = githubCard.getByRole("button", { name: "Login with GitHub", exact: true });

  if (!(await loginButton.isVisible())) {
    await githubCard.getByText(/^GitHub login$/i).click();
  }

  await expect(loginButton).toBeVisible();
  const authenticated = githubCard.getByText(/Authenticated as/i);
  const corpUrl = new URL(CORP_URL);
  const authenticationResult = authenticated.waitFor({ state: "visible", timeout: 120_000 }).then(
    () => ({ outcome: "authenticated" as const }),
    (error: unknown) => ({ outcome: "timeout" as const, error })
  );
  const redirectResult = page
    .waitForURL(
      (url) => {
        return url.origin !== corpUrl.origin || url.pathname !== corpUrl.pathname;
      },
      { timeout: 120_000 }
    )
    .then(
      () => ({ outcome: "redirect" as const, redirectUrl: page.url() }),
      (error: unknown) => ({ outcome: "timeout" as const, error })
    );

  await loginButton.click({ noWaitAfter: true });
  const result = await Promise.race([authenticationResult, redirectResult]);
  if (result.outcome === "redirect") {
    const message = `GitHub authentication redirected before sign-in completed: ${result.redirectUrl}`;
    console.error(message);
    throw new Error(message);
  }
  if (result.outcome === "timeout") {
    const message = "GitHub authentication failed due to a timeout. Ensure that backend is running.";
    console.error(message, result.error);
    throw new Error(message, { cause: result.error });
  }

  await expect(authenticated).toBeVisible();

  await page.context().storageState({ path: githubStorageStateFile });
  await saveGithubSessionStorage(context);
  console.log(`Saved storage state: ${githubStorageStateFile}`);
  console.log(`Saved session state: ${githubSessionStorageFile}`);
});
