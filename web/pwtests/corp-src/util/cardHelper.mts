/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { expect, type Page } from "@playwright/test";

export async function expandGithubLoginCard(page: Page) {
  const githubCard = page.locator("#card-github_login");
  const introText = githubCard.getByText(
    /Connect your GitHub account so ZenInstaller can create the repository, environment, and secrets needed to deploy Zenblox\./i
  );
  if (!(await introText.isVisible())) {
    await githubCard.getByText(/^GitHub login$/i).click();
  }
  await expect(introText).toBeVisible();
  return githubCard;
}

export async function expandAzureLoginCard(page: Page) {
  const azureCard = page.locator("#card-azure_login");
  const introText = azureCard.getByText(/Sign in with Azure so we can create the app registration and cloud resources for you\./i);
  if (!(await introText.isVisible())) {
    await azureCard.getByText(/^Azure login$/i).click();
  }
  await expect(introText).toBeVisible();
  return azureCard;
}

export async function expandRepoCard(page: Page) {
  const repoCard = page.locator("#card-repo");
  const repoInput = repoCard.getByRole("combobox", { name: "Select or type repo name..." });
  if (!(await repoInput.isVisible())) {
    await repoCard.getByText(/^Repository & environment$/i).click();
  }
  await expect(repoInput).toBeVisible();
  return repoCard;
}

export async function expandAzureSubscriptionCard(page: Page) {
  const subscriptionCard = page.locator("#card-azure_subscription");
  const introText = subscriptionCard.getByText(/Pick the subscription to deploy into\./i);
  if (!(await introText.isVisible())) {
    await subscriptionCard.getByText(/^Choose Azure subscription$/i).click();
  }
  await expect(introText).toBeVisible();
  return subscriptionCard;
}

export async function expandAzureAppRegistrationCard(page: Page) {
  const appRegistrationCard = page.locator("#card-azure_app_registration");
  const introText = appRegistrationCard.getByText(/Create an app registration for GitHub Actions/i);
  if (!(await introText.isVisible())) {
    await appRegistrationCard.getByText(/^Create an app registration in Azure$/i).click();
  }
  await expect(introText).toBeVisible();
  return appRegistrationCard;
}
