/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import * as B from "./backend";
import { createGithubApi } from "./github";
import type { ApiProvider } from "./github";

// ─── Provider ─────────────────────────────────────────────────────────────────
/*
 * Swap at runtime — token is injected into the github provider at switch time,
 * not passed on every call.
 */

let _provider: ApiProvider = B;

export const switchToDirect = (token: string) => {
  _provider = createGithubApi(token);
};
export const switchToBackend = () => {
  _provider = B;
};

// Re-export factory so callers can inspect / create a provider directly
export { createGithubApi } from "./github";
export type { ApiProvider } from "./github";

// fetchGithubUser — used with an explicit token before provider is set (initial PAT check)
export { fetchGithubUser } from "./github";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const verifyAuth: ApiProvider["verifyAuth"] = () => _provider.verifyAuth();

// ─── Orgs & Repos ─────────────────────────────────────────────────────────────

export const fetchOrgList: ApiProvider["fetchOrgList"] = (...a) => _provider.fetchOrgList(...a);
export const fetchRepos: ApiProvider["fetchRepos"] = (...a) => _provider.fetchRepos(...a);

// ─── Template ─────────────────────────────────────────────────────────────────

export const checkTemplate: ApiProvider["checkTemplate"] = (...a) => _provider.checkTemplate(...a);

// ─── Repo generation ──────────────────────────────────────────────────────────

export const generateRepo: ApiProvider["generateRepo"] = (...a) => _provider.generateRepo(...a);

// ─── Branches ─────────────────────────────────────────────────────────────────

export const fetchBranches: ApiProvider["fetchBranches"] = (...a) => _provider.fetchBranches(...a);
export const createBranch: ApiProvider["createBranch"] = (...a) => _provider.createBranch(...a);

// ─── Pull Requests ────────────────────────────────────────────────────────────

export const fetchPullRequests: ApiProvider["fetchPullRequests"] = (...a) => _provider.fetchPullRequests(...a);

// ─── Workflow Runs ────────────────────────────────────────────────────────────

export const fetchRuns: ApiProvider["fetchRuns"] = (...a) => _provider.fetchRuns(...a);

// ─── Environments ─────────────────────────────────────────────────────────────

export const fetchEnvs: ApiProvider["fetchEnvs"] = (...a) => _provider.fetchEnvs(...a);

// ─── Secrets ──────────────────────────────────────────────────────────────────

export const fetchSecrets: ApiProvider["fetchSecrets"] = (...a) => _provider.fetchSecrets(...a);
export const fetchPublicKey: ApiProvider["fetchPublicKey"] = (...a) => _provider.fetchPublicKey(...a);
export const upsertSecret: ApiProvider["upsertSecret"] = (...a) => _provider.upsertSecret(...a);

// ─── Variables ────────────────────────────────────────────────────────────────

export const fetchVariables: ApiProvider["fetchVariables"] = (...a) => _provider.fetchVariables(...a);
export const createVariable: ApiProvider["createVariable"] = (...a) => _provider.createVariable(...a);
export const updateVariable: ApiProvider["updateVariable"] = (...a) => _provider.updateVariable(...a);
export const deleteVariable: ApiProvider["deleteVariable"] = (...a) => _provider.deleteVariable(...a);

// ─── Status & Env files ───────────────────────────────────────────────────────

export const fetchStageReport: ApiProvider["fetchStageReport"] = (...a) => _provider.fetchStageReport(...a);
export const fetchArtifactZip: ApiProvider["fetchArtifactZip"] = (...a) => _provider.fetchArtifactZip(...a);
export const fetchEnv: ApiProvider["fetchEnv"] = (...a) => _provider.fetchEnv(...a);

// ─── Artifacts ────────────────────────────────────────────────────────────────

export const getPlanEnv: ApiProvider["getPlanEnv"] = (...a) => _provider.getPlanEnv(...a);
export const fetchLogArtifact: ApiProvider["fetchLogArtifact"] = (...a) => _provider.fetchLogArtifact(...a);
export const fetchPlan: ApiProvider["fetchPlan"] = (...a) => _provider.fetchPlan(...a);

// ─── Workflow dispatch ────────────────────────────────────────────────────────

export const setOidcImmutableSubject: ApiProvider["setOidcImmutableSubject"] = (...a) => _provider.setOidcImmutableSubject(...a);
export const triggerWorkflow: ApiProvider["triggerWorkflow"] = (...a) => _provider.triggerWorkflow(...a);
export const triggerWorkflowFromPR: ApiProvider["triggerWorkflowFromPR"] = (...a) => _provider.triggerWorkflowFromPR(...a);
export const triggerRemoteLogin: ApiProvider["triggerRemoteLogin"] = (...a) => _provider.triggerRemoteLogin(...a);
