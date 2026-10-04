/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// Has browser viewport and URL configuration

export const HOME_URL = "http://localhost:5173/";
export const ACCESS_PASS_URL = "http://localhost:5173/accessPass.html";
export const CORP_URL = "http://localhost:5173/";
export const BACKEND_URL = "http://localhost:7071";

// Mock test APIs
export const MOCK_BACKEND_URL = "http://localhost:7071";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_API_URL_REGEX = "https://api\\.github\\.com";
export const AZURE_MANAGEMENT_URL = "https://management.azure.com";
export const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com";
export const MICROSOFT_LOGIN_URL = "https://login.microsoftonline.com";
export const AZURE_MANAGEMENT_SCOPE = `${AZURE_MANAGEMENT_URL}/user_impersonation`;
export const GRAPH_APPLICATION_SCOPE = `${MICROSOFT_GRAPH_URL}/application.readwrite.all`;
export const GRAPH_APP_ROLE_ASSIGNMENT_SCOPE = `${MICROSOFT_GRAPH_URL}/approleassignment.readwrite.all`;

/* GITHUB_TOKEN must be configured in web/.env file due to Github commit security */
export const SUBSCRIPTION_ID = "Zenme Azure 1";

// Repo names to be used repo creation
export const TEST_REPO_MAIN = "pwtests"; // creating repo with env variables
export const TEST_REPO_NO_ENV = "pwtests-no-env"; // creating repo with no env variables
export const TEST_REPO_FROM_PROD = "pwtests-test-from-prod"; // creating test branch from existing prod branch

export const viewports = {
  Desktop: { width: 1280, height: 720 },
  Mobile: { width: 414, height: 896 },
} as const;

export type ViewportName = keyof typeof viewports;
export type ViewportSize = (typeof viewports)[ViewportName];
