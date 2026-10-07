/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// Mirrors ZBCorpArchitecture util/namingConvention.cjs — keep in sync.

export function getRootResourceGroupName(corpName: string): string {
  return `root-${corpName}`;
}

export function getLogAnalyticsWorkspaceName(corpName: string): string {
  return `${corpName}-law`;
}

export function getStorageAccountName(corpName: string): string {
  return `${corpName}pvt`.toLowerCase();
}

export function getAppInsightsName(corpName: string): string {
  return `${corpName}-appinsights`;
}

// Remote terminal infrastructure — its own resource group so it can be torn down on its own.
export function getTerminalResourceGroupName(corpName: string): string {
  return `terminal-${corpName}`;
}

export function getTerminalStorageAccountName(corpName: string): string {
  return `${corpName}term`.toLowerCase();
}

// One private installer environment per tenant, so these are fixed rather than derived from the corp.
export const PRIVATE_RESOURCE_GROUP = "zeninstaller-private-rg";
export const PRIVATE_LOG_ANALYTICS = "zeninstaller-private-law";
/*
 * Storage account names are globally unique across all of Azure, so a fixed one would be claimed by
 * whoever installs first. The subscription's own id is random, per-customer and stable, which keeps
 * the name both collision-free and the same on every re-run. 18 + 6 is Azure's limit of 24 exactly.
 */
export function getWebStorageAccountName(subscriptionId: string): string {
  return `zeninstallerpvtweb${subscriptionId.replace(/-/g, "").slice(0, 6)}`.toLowerCase();
}

// The private installer's own sign-in app, so consent happens in the customer's tenant.
export function getPrivateInstallerAppName(): string {
  return "Zeninstaller Private";
}

export function getTerminalWebPubSubName(corpName: string): string {
  return `${corpName}-wpubsub`;
}

// The identity GitHub Actions mints Web PubSub tokens with, kept apart from the plan pipeline's.
export function getTerminalPipelineAppName(corpName: string): string {
  return `${corpName}-terminal-pipeline`;
}

export function getTerminalFunctionAppName(corpName: string): string {
  return `${corpName}-terminal-app`;
}

export function getTerminalLogAnalyticsWorkspaceName(corpName: string): string {
  return `${corpName}-terminal-law`;
}

export function getTerminalAppInsightsName(corpName: string): string {
  return `${corpName}-terminal-ai`;
}

export const TERMINAL_HUB = "terminal";
export const TERMINAL_SESSION_TABLE = "sessions";
export const TERMINAL_DEPLOY_CONTAINER = "deployment";

export const TFSTATE_CONTAINER = "terraformstate";
export const DIAGNOSTIC_SETTING_NAME = "standard-diagnostics-setting";
export const DEFAULT_AZURE_LOCATION = "australiaeast";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

const FIC_NAME_MAX = 120;

// Our own naming scheme for a GitHub Actions federated-credential's display name in Entra
// (unrelated to ZBCorpArchitecture — this one isn't dictated by an external contract).
export function getFederatedCredentialName(org: string, repo: string, environment: string, suffix = ""): string {
  const base = `${slug(org)}-${slug(repo)}-${slug(environment)}`;
  const full = base.length <= 113 ? `github-${base}` : base;
  return full.slice(0, FIC_NAME_MAX - suffix.length) + suffix;
}

// The repo segment of GitHub's immutable OIDC subject; "@" can't appear in an org or repo name.
export function getImmutableRepoSegment(org: string, orgId: number, repo: string, repoId: number): string {
  return `repo:${org}@${orgId}/${repo}@${repoId}`;
}

export function getFederatedCredential(org: string, orgId: number, repo: string, repoId: number, environment: string): { name: string; subject: string } {
  // The "-id" suffix keeps this from colliding with a legacy-format credential left by an earlier run.
  return {
    name: getFederatedCredentialName(org, repo, environment, "-id"),
    subject: getFederatedSubject(org, orgId, repo, repoId, environment),
  };
}

// The OIDC sub claim a GitHub Actions run emits — matched verbatim by Entra and by AWS IAM alike.
export function getFederatedSubject(org: string, orgId: number, repo: string, repoId: number, environment: string): string {
  return `${getImmutableRepoSegment(org, orgId, repo, repoId)}:environment:${environment}`;
}
