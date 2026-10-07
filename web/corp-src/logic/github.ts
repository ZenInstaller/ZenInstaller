/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// GitHub URL builders shared across corp-src.

export const GITHUB_LOGIN_URL = "https://github.com/login";

export function getGithubUserUrl(login: string): string {
  return `https://github.com/${login}`;
}

export function getRepoUrl(repoFullName: string): string {
  return `https://github.com/${repoFullName}`;
}

export function getEnvSettingsUrl(repoFullName: string, envId: number): string {
  return `https://github.com/${repoFullName}/settings/environments/${envId}/edit`;
}

export function getEnvironmentsUrl(repoFullName: string): string {
  return `https://github.com/${repoFullName}/settings/environments`;
}

export function getVariablesUrl(repoFullName: string): string {
  return `https://github.com/${repoFullName}/settings/variables/actions`;
}

// Where to look before a build has ever reported — the workflow's own run history.
export function getWorkflowUrl(repoFullName: string, workflowId: string): string {
  return `https://github.com/${repoFullName}/actions/workflows/${workflowId}`;
}

export function getWorkflowRunUrl(repoFullName: string, runId: string): string {
  return `https://github.com/${repoFullName}/actions/runs/${runId}`;
}
