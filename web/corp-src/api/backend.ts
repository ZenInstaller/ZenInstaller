import { parse } from "dotenv";
import JSZip from "jszip";
import type { Account, Branch, GhEnv, PullRequest, Repo, StageReport, WorkflowRun, UpsertSecretResult } from "../types";
import { toStageReport } from "../logic/stage";
import { getStoredToken } from "../logic/tokenStore";
import { GITHUB_TOKEN_KEYS } from "../config/githubConfig";
import { requireMsToken } from "../cards/AzureLogin/msal";
import { readBlobWithProgress, type DownloadProgress } from "../logic/download";
import type { RemoteLoginDispatch } from "./github";
import { REMOTE_TERMINAL_TTL_SECONDS } from "../config/remoteTerminal";
import { ARM_SCOPES } from "../config/azureConfig";
import type { SessionCredentials } from "../logic/remoteTerminal";

const url = import.meta.env.VITE_API_URL;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/*
 * The browser holds the GitHub token now, so it travels as a bearer header rather than a session
 * cookie. A 401 means that token is no longer good, and only a fresh sign-in fixes it.
 */
// Named to match the backend's own constants. Microsoft tokens are scope-specific, so the caller
// passes whichever one the endpoint needs; the GitHub one has no scopes to choose between.
export const GH_TOKEN_HEADER = "Zb.Github.Authorization";
export const MS_TOKEN_HEADER = "Zb.Msal.Authorization";

// msScopes says this endpoint authorises against the Microsoft identity; the scopes decide which
// token, so the caller names them rather than handing one over.
export type AuthedInit = RequestInit & { msScopes?: string[] };

export async function fetchWithAuth(input: string, init: AuthedInit = {}): Promise<Response> {
  const { msScopes, ...requestInit } = init;
  const token = getStoredToken(GITHUB_TOKEN_KEYS);
  const headers: Record<string, string> = {
    ...((requestInit.headers as Record<string, string>) ?? {}),
    ...(token ? { [GH_TOKEN_HEADER]: `Bearer ${token}` } : {}),
    ...(msScopes ? { [MS_TOKEN_HEADER]: `Bearer ${await requireMsToken(msScopes)}` } : {}),
    ...((requestInit.method ?? "GET").toUpperCase() === "POST" ? { "X-CSRF-Token": "1" } : {}),
  };
  const res = await fetch(input, { ...requestInit, headers });
  // A Microsoft 401 says nothing about the GitHub session, and this event is what marks it expired.
  if (res.status === 401 && !msScopes) window.dispatchEvent(new CustomEvent("auth:session-expired"));
  return res;
}

/*
 * The one call made before a token exists, which is why it uses a bare fetch rather than
 * fetchWithAuth. The exchange needs GitHub's client secret, so only the backend can make it.
 */
export async function exchangeGithubCode(body: {
  client_id: string;
  code: string;
  code_verifier: string;
  redirect_uri: string;
}): Promise<{ access_token?: string; error?: string }> {
  const res = await fetch(`${url}/getGhToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function verifyAuth(): Promise<{ login: string }> {
  const res = await fetchWithAuth(`${url}/getUser`);
  if (!res.ok) throw new Error("Unauthorized");
  const data = await res.json();
  return data.user;
}

// ─── Orgs & Repos ─────────────────────────────────────────────────────────────

export async function fetchOrgList(): Promise<Account[]> {
  const [userRes, orgsRes] = await Promise.all([fetchWithAuth(`${url}/getUser`), fetchWithAuth(`${url}/getOrgs`)]);
  if (!userRes.ok) throw new Error(`Failed to fetch user: ${userRes.status}`);
  if (!orgsRes.ok) throw new Error(`Failed to fetch orgs: ${orgsRes.status}`);
  const [userData, orgsData] = await Promise.all([userRes.json(), orgsRes.json()]);
  return [
    { login: userData.user.login, type: "User", id: userData.user.id },
    ...orgsData.orgList.map((o: { login: string; id: number }) => ({
      login: o.login,
      type: "Organization" as const,
      id: o.id,
    })),
  ];
}

export async function fetchRepos(account: Account): Promise<Repo[]> {
  const params = new URLSearchParams({ owner: account.login, type: account.type });
  const res = await fetchWithAuth(`${url}/getRepos?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch repos: ${res.status}`);
  const data = await res.json();
  return data.repoList || [];
}

// ─── Template ─────────────────────────────────────────────────────────────────

export async function checkTemplate(
  account: Account,
  repo: string,
): Promise<{ isTemplate: boolean; templateName: string }> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type });
  const res = await fetchWithAuth(`${url}/checkTemplate?${params}`);
  if (!res.ok) throw new Error(`Failed to check template: ${res.status}`);
  return res.json();
}

// ─── Repo generation ──────────────────────────────────────────────────────────

export async function generateRepo(
  account: Account,
  targetName: string,
  isPrivate: boolean,
  includeAllBranch: boolean,
  createEnvs: boolean,
  templateRepo?: string,
  validEnvs?: readonly string[],
): Promise<{
  repo: Repo;
  envSuccess: boolean;
  results: { envs: { name: string; success: boolean; error?: string }[] };
}> {
  const res = await fetchWithAuth(`${url}/generateRepo`, {
    method: "POST",
    body: JSON.stringify({
      includeAllBranch,
      isPrivate,
      createEnvs,
      owner: account.login,
      type: account.type,
      repo: targetName,
      templateRepo,
      envNames: validEnvs,
    }),
  });
  if (!res.ok) throw new Error(`Failed to clone repo: ${res.status}`);
  const data = await res.json();
  return { repo: data.data, envSuccess: data.envSuccess, results: data.results };
}

// ─── Branches ─────────────────────────────────────────────────────────────────

export async function fetchBranches(account: Account, repo: string): Promise<Branch[]> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type });
  const res = await fetchWithAuth(`${url}/getBranches?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch branches: ${res.status}`);
  const data = await res.json();
  return data.branches || [];
}

export async function createBranch(
  account: Account,
  repo: string,
  branchName: string,
  sourceBranch: string,
): Promise<Branch> {
  const res = await fetchWithAuth(`${url}/createBranch`, {
    method: "POST",
    body: JSON.stringify({ owner: account.login, type: account.type, repo, branch: branchName, source: sourceBranch }),
  });
  if (!res.ok) throw new Error(`Failed to create branch: ${res.status}`);
  const data = await res.json();
  return data.branch;
}

// ─── Pull Requests ────────────────────────────────────────────────────────────

export async function fetchPullRequests(account: Account, repo: string): Promise<PullRequest[]> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type });
  const res = await fetchWithAuth(`${url}/getPullRequests?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch pull requests: ${res.status}`);
  const data = await res.json();
  return data.pullRequests || [];
}

// ─── Workflow Runs ────────────────────────────────────────────────────────────

export async function fetchRuns(account: Account, repo: string, headSha: string): Promise<WorkflowRun[]> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type, head_sha: headSha });
  const res = await fetchWithAuth(`${url}/getRuns?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  const data = await res.json();
  return data.runs || [];
}

// ─── GitHub Environments ──────────────────────────────────────────────────────

export async function fetchEnvs(account: Account, repo: string): Promise<GhEnv[]> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type });
  const res = await fetchWithAuth(`${url}/getEnvs?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch envs: ${res.status}`);
  const data = await res.json();
  return data.envList || [];
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

export async function fetchSecrets(account: Account, repo: string, envName: string): Promise<string[]> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type, env: envName });
  const res = await fetchWithAuth(`${url}/getSecrets?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch secrets: ${res.status}`);
  const data = await res.json();
  return (data.secrets || []) as string[];
}

export async function fetchPublicKey(
  account: Account,
  repo: string,
  envName?: string,
): Promise<{ key: string; keyId: string }> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type });
  if (envName) params.set("env", envName);
  const res = await fetchWithAuth(`${url}/getPublicKey?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch public key: ${res.status}`);
  const data = await res.json();
  return { key: data.key, keyId: data.keyId };
}

export async function upsertSecret(
  account: Account,
  repo: string,
  name: string,
  encryptedValue: string,
  keyId: string,
  envName?: string,
): Promise<UpsertSecretResult> {
  const res = await fetchWithAuth(`${url}/upsertSecret`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner: account.login,
      repo,
      type: account.type,
      name,
      value: encryptedValue,
      keyId,
      ...(envName ? { env: envName } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Failed to upsert secret "${name}": ${res.status}`);
  return res.json();
}

// ─── Variables ────────────────────────────────────────────────────────────────

export async function fetchVariables(account: Account, repo: string, envName: string): Promise<Record<string, string>> {
  const params = new URLSearchParams({ owner: account.login, repo, type: account.type, env: envName });
  const res = await fetchWithAuth(`${url}/getVariables?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch variables: ${res.status}`);
  const data = await res.json();
  return data.variables || {};
}

export async function createVariable(
  account: Account,
  repo: string,
  name: string,
  value: string,
  envName: string,
): Promise<void> {
  const res = await fetchWithAuth(`${url}/createVariable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: account.login, repo, name, value, env: envName }),
  });
  if (!res.ok) throw new Error(`Failed to create variable "${name}": ${res.status}`);
}

export async function updateVariable(
  account: Account,
  repo: string,
  name: string,
  value: string,
  envName: string,
): Promise<void> {
  const res = await fetchWithAuth(`${url}/updateVariable`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: account.login, repo, name, value, env: envName }),
  });
  if (!res.ok) throw new Error(`Failed to update variable "${name}": ${res.status}`);
}

export async function deleteVariable(account: Account, repo: string, name: string, envName: string): Promise<void> {
  const res = await fetchWithAuth(`${url}/deleteVariable`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: account.login, repo, name, env: envName }),
  });
  if (!res.ok) throw new Error(`Failed to delete variable "${name}": ${res.status}`);
}

// ─── Status file ──────────────────────────────────────────────────────────────

// A stage's own latest plan result, recorded by the workflow as a Deployment. Queried by task
// rather than fetched in bulk: every run that declares an environment also creates a deployment of
// GitHub's own, so a stage's latest can fall off the first page of an unfiltered list.
export async function fetchStageReport(
  account: Account,
  repo: string,
  envName: string,
  dir: string,
  kind: "plan" | "deploy" | "build",
): Promise<StageReport | null> {
  const params = new URLSearchParams({
    owner: account.login,
    repo,
    environment: envName,
    task: `${kind}:${dir}`,
    per_page: "1",
  });
  const res = await fetchWithAuth(`${url}/getDeployments?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch the report for "${dir}": ${res.status}`);
  const { deployments } = await res.json();
  const latest = deployments?.[0];
  return latest ? toStageReport(latest.payload, latest.created_at, latest.sha) : null;
}

// ─── Env ──────────────────────────────────────────────────────────────────────

export async function fetchEnv(account: Account, repo: string): Promise<Record<string, string> | null> {
  const params = new URLSearchParams({ path: "corpSetup/corp.env", owner: account.login, repo, type: account.type });
  const res = await fetchWithAuth(`${url}/getContents?${params}`);
  if (res.status === 404) return null; // file doesn't exist yet
  if (!res.ok) throw new Error(`Failed to fetch env: ${res.status}`);
  const data = await res.json();
  return parse(data.content);
}
// TODO: getPlanEnv need to replace downloadArtifacts with downloadArtifactZip
export async function getPlanEnv(
  account: Account,
  repo: string,
  envId: number,
): Promise<Record<string, string> | null> {
  const params = new URLSearchParams({ artifacts_id: String(envId), owner: account.login, type: account.type, repo });
  const res = await fetchWithAuth(`${url}/downloadArtifacts?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const zip = await JSZip.loadAsync(data.content as string, { base64: true });
  const envFile = zip.file("corp.env");
  if (!envFile) return null;
  const content = await envFile.async("string");
  return parse(content);
}

// ─── OIDC ─────────────────────────────────────────────────────────────────────

// Opts the repo into GitHub's immutable OIDC subject, so the sub claim carries owner/repo ids.
export async function setOidcImmutableSubject(account: Account, repo: string): Promise<void> {
  const res = await fetchWithAuth(`${url}/setOidcSubject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: account.login, repo }),
  });
  if (!res.ok) throw new Error(`Failed to set OIDC subject: ${res.status}`);
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export async function triggerWorkflow(
  account: Account,
  repo: string,
  workflowId: string,
  githubEnvName: string,
  ref: string,
) {
  const res = await fetchWithAuth(`${url}/triggerActions`, {
    method: "POST",
    body: JSON.stringify({
      repo,
      owner: account.login,
      type: account.type,
      workflow_id: workflowId,
      ref,
      github_env_name: githubEnvName,
    }),
  });
  if (!res.ok) throw new Error(`Failed to trigger workflow: ${res.status}`);
  return res.json();
}

export async function triggerWorkflowFromPR(
  account: Account,
  repo: string,
  workflowId: string,
  githubEnvName: string,
  commitSha: string,
) {
  const res = await fetchWithAuth(`${url}/triggerActions`, {
    method: "POST",
    body: JSON.stringify({
      repo,
      owner: account.login,
      type: account.type,
      workflow_id: workflowId,
      ref: commitSha,
      github_env_name: githubEnvName,
    }),
  });
  if (!res.ok) throw new Error(`Failed to trigger workflow from PR: ${res.status}`);
  return res.json();
}

export async function fetchArtifactZip(
  account: Account,
  repo: string,
  artifactId: number,
  onProgress?: DownloadProgress,
): Promise<Blob> {
  const params = new URLSearchParams({
    artifacts_id: String(artifactId),
    owner: account.login,
    repo,
    type: account.type,
  });
  const res = await fetchWithAuth(`${url}/downloadArtifactZip?${params}`);
  if (!res.ok) throw new Error(`Failed to download the package: ${res.status}`);
  return readBlobWithProgress(res, onProgress);
}

// Hands the workflow the session the browser already registered, never the access token.
export async function triggerRemoteLogin(account: Account, repo: string, opts: RemoteLoginDispatch) {
  const res = await fetchWithAuth(`${url}/triggerActions`, {
    method: "POST",
    body: JSON.stringify({
      repo,
      owner: account.login,
      type: account.type,
      workflow_id: opts.workflowId,
      ref: opts.ref,
      github_env_name: opts.githubEnvName,
      session_id: opts.sessionId,
      dir: opts.dir,
      plan_run_id: opts.planRunId,
    }),
  });
  if (!res.ok) throw new Error(`Failed to start the remote login workflow: ${res.status}`);
  return res.json();
}

// ─── Deploy error (from artifact log) ────────────────────────────────────────
// TODO: fetchLogArtifact need to replace downloadArtifacts with downloadArtifactZip
export async function fetchLogArtifact(account: Account, repo: string, logId: number): Promise<string | null> {
  const params = new URLSearchParams({ artifacts_id: String(logId), owner: account.login, type: account.type, repo });
  const res = await fetchWithAuth(`${url}/downloadArtifacts?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const zip = await JSZip.loadAsync(data.content as string, { base64: true });
  const logFile = Object.values(zip.files).find((f) => !f.dir);
  if (!logFile) return null;
  return logFile.async("string");
}

// ─── Plan (artifact) ──────────────────────────────────────────────────────────
// TODO: fetchPlan need to replace downloadArtifacts with downloadArtifactZip
export async function fetchPlan(id: string, account: { login: string; type: string }, repo: string) {
  const params = new URLSearchParams({ artifacts_id: id, owner: account.login, type: account.type, repo, ref: "dev" });
  const res = await fetchWithAuth(`${url}/downloadArtifacts?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch plan for ${id}`);
  const data = await res.json();
  const zip = await JSZip.loadAsync(data.content as string, { base64: true });
  const fileName = Object.keys(zip.files).find((f) => f.endsWith(".json"));
  if (!fileName) throw new Error("No JSON file found in artifact zip");
  const content = await zip.file(fileName)!.async("string");
  return JSON.parse(content);
}

// ─── Remote terminal ──────────────────────────────────────────────────────────

// Temporary: points the terminal endpoints at their own Function App; delete once they share one.
const terminalUrl = import.meta.env.VITE_TERMINAL_API_URL || url;

// The relay guards Azure resources, so it checks the Microsoft identity, not the GitHub one.
const MS_AUTHED = { msScopes: ARM_SCOPES };

export async function registerSession({ sessionId, accessToken }: SessionCredentials): Promise<void> {
  const res = await fetchWithAuth(`${terminalUrl}/terminal/register`, {
    ...MS_AUTHED,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, accessToken, ttlSeconds: REMOTE_TERMINAL_TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`Failed to register the terminal session: ${res.status}`);
}

// Returns the Web PubSub client URL, already scoped to this session's group.
export async function negotiateSession({ sessionId, accessToken }: SessionCredentials): Promise<string> {
  const params = new URLSearchParams({ session: sessionId, token: accessToken });
  const res = await fetchWithAuth(`${terminalUrl}/terminal/negotiate?${params}`, { ...MS_AUTHED, method: "POST" });
  if (!res.ok) throw new Error(`Failed to negotiate the terminal session: ${res.status}`);
  const data = await res.json();
  const clientUrl = typeof data.url === "string" ? data.url : data.url?.url;
  if (typeof clientUrl !== "string") throw new Error("Unexpected negotiate response");
  return clientUrl;
}

// Best effort — the session row carries a TTL, so a failure here costs nothing.
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetchWithAuth(`${terminalUrl}/terminal/session/${sessionId}`, { ...MS_AUTHED, method: "DELETE" });
  } catch {
    /* empty */
  }
}
