/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { parse } from "dotenv";
import JSZip from "jszip";
import type { Account, Branch, GhEnv, PullRequest, Repo, StageReport, WorkflowRun, UpsertSecretResult } from "../types";
import { toStageReport } from "../logic/stage";
import { readBlobWithProgress, type DownloadProgress } from "../logic/download";

const GH = "https://api.github.com";

function decodeContent(encoded: string): string {
  return atob(encoded.replace(/\n/g, ""));
}

// ─── Standalone — used before provider is set (initial login check) ───────────

export async function fetchGithubUser(token: string): Promise<{ login: string; id: number }> {
  const res = await fetch(`${GH}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error("Unauthorized");
  return res.json();
}

// ─── Provider factory — token injected once, all calls use it via closure ─────

export type RemoteLoginDispatch = {
  workflowId: string;
  githubEnvName: string;
  ref: string;
  sessionId: string;
  dir: string;
  // The plan run whose tfplan the workflow applies once the sign-in completes.
  planRunId: string;
};

export function createGithubApi(token: string) {
  function hdr(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }

  async function gh(path: string, init: RequestInit = {}): Promise<Response> {
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase());
    return fetch(`${GH}${path}`, {
      ...init,
      headers: { ...hdr(isWrite ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  }

  async function paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = `${GH}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (url) {
      const res = await fetch(url, { headers: hdr() });
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${url}`);
      const data = await res.json();
      // Some endpoints return { total_count, items: [...] } instead of a bare array
      const page: T[] = Array.isArray(data) ? data : ((Object.values(data as object).find(Array.isArray) as T[]) ?? []);
      results.push(...page);
      const link = res.headers.get("Link");
      url = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return results;
  }

  // Raw bytes rather than a parsed zip: the backend package goes straight to the Function App.
  async function fetchArtifactZip(account: Account, repo: string, artifactId: number, onProgress?: DownloadProgress): Promise<Blob> {
    const res = await gh(`/repos/${account.login}/${repo}/actions/artifacts/${artifactId}/zip`);
    if (!res.ok) throw new Error(`Failed to download the package: ${res.status}`);
    return readBlobWithProgress(res, onProgress);
  }

  // Same download, parsed — for callers that read files out of the artifact rather than forward it.
  async function downloadZip(account: Account, repo: string, artifactId: number): Promise<JSZip> {
    return JSZip.loadAsync(await fetchArtifactZip(account, repo, artifactId));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  async function verifyAuth(): Promise<{ login: string }> {
    const res = await gh("/user");
    if (!res.ok) throw new Error("Unauthorized");
    const data = await res.json();
    return { login: data.login };
  }

  // ── Orgs & Repos ──────────────────────────────────────────────────────────────

  async function fetchOrgList(): Promise<Account[]> {
    const [user, orgs] = await Promise.all([fetchGithubUser(token), paginate<{ login: string; id: number }>("/user/orgs")]);
    return [{ login: user.login, type: "User", id: user.id }, ...orgs.map((o) => ({ login: o.login, type: "Organization" as const, id: o.id }))];
  }

  async function fetchRepos(account: Account): Promise<Repo[]> {
    const path = account.type === "Organization" ? `/orgs/${account.login}/repos?type=all` : `/user/repos?type=owner`;
    const all = await paginate<{ id: number; name: string; owner: { type: string } }>(path);
    return all.filter((r) => r.owner.type === account.type).map((r) => ({ id: r.id, name: r.name }));
  }

  // ── Template ──────────────────────────────────────────────────────────────────

  async function checkTemplate(account: Account, repo: string): Promise<{ templateName: string }> {
    const res = await gh(`/repos/${account.login}/${repo}`);
    if (!res.ok) throw new Error(`Failed to check template: ${res.status}`);
    const data = await res.json();
    return { templateName: data.template_repository?.full_name ?? "" };
  }

  // ── Repo generation ───────────────────────────────────────────────────────────

  async function generateRepo(
    account: Account,
    targetName: string,
    isPrivate: boolean,
    includeAllBranch: boolean,
    createEnvs: boolean,
    templateRepo: string,
    validEnvs: readonly string[]
  ): Promise<{
    repo: Repo;
    envSuccess: boolean;
    results: { envs: { name: string; success: boolean; error?: string }[] };
  }> {
    const [templateOwner, templateName] = templateRepo.split("/");
    const res = await gh(`/repos/${templateOwner}/${templateName}/generate`, {
      method: "POST",
      body: JSON.stringify({
        owner: account.login,
        name: targetName,
        private: isPrivate,
        include_all_branches: includeAllBranch,
      }),
    });
    if (!res.ok) throw new Error(`Failed to generate repo: ${res.status}`);
    const data = await res.json();
    const repo: Repo = { id: data.id, name: data.name };
    if (!createEnvs) return { repo, envSuccess: true, results: { envs: [] } };
    const envResults = await Promise.all(
      validEnvs.map(async (envName) => {
        const r = await gh(`/repos/${account.login}/${data.name}/environments/${envName}`, {
          method: "PUT",
          body: JSON.stringify({}),
        });
        return { name: envName, success: r.ok, error: r.ok ? undefined : String(r.status) };
      })
    );
    return { repo, envSuccess: envResults.every((e) => e.success), results: { envs: envResults } };
  }

  // ── Branches ──────────────────────────────────────────────────────────────────

  async function fetchBranches(account: Account, repo: string): Promise<Branch[]> {
    const all = await paginate<{ name: string; commit: { sha: string }; protected: boolean }>(`/repos/${account.login}/${repo}/branches`);
    return all.map((b) => ({ name: b.name, commit: b.commit.sha, protected: b.protected }));
  }

  async function createBranch(account: Account, repo: string, branchName: string, sourceBranch: string): Promise<Branch> {
    const refRes = await gh(`/repos/${account.login}/${repo}/git/ref/heads/${sourceBranch}`);
    if (!refRes.ok) throw new Error(`Failed to resolve source branch "${sourceBranch}": ${refRes.status}`);
    const { object } = await refRes.json();
    const res = await gh(`/repos/${account.login}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: object.sha }),
    });
    if (!res.ok) throw new Error(`Failed to create branch "${branchName}": ${res.status}`);
    return { name: branchName, commit: object.sha, protected: false };
  }

  // ── Pull Requests ─────────────────────────────────────────────────────────────

  async function fetchPullRequests(account: Account, repo: string): Promise<PullRequest[]> {
    const all = await paginate<{
      id: number;
      number: number;
      title: string;
      state: string;
      html_url: string;
      base: { ref: string };
      head: { sha: string };
    }>(`/repos/${account.login}/${repo}/pulls?state=open`);
    return all.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      html_url: pr.html_url,
      base_branch: pr.base.ref,
      head_sha: pr.head.sha,
    }));
  }

  // ── Workflow Runs ─────────────────────────────────────────────────────────────

  async function fetchRuns(account: Account, repo: string, headSha: string): Promise<WorkflowRun[]> {
    const res = await gh(`/repos/${account.login}/${repo}/actions/runs?head_sha=${headSha}&per_page=100`);
    if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
    const data = await res.json();
    return (data.workflow_runs ?? []).map((r: { id: number; head_sha: string; workflow_id: number; created_at: string; actor: { login: string } }) => ({
      id: r.id,
      head_sha: r.head_sha,
      workflow_id: String(r.workflow_id),
      created_at: r.created_at,
      actor: r.actor?.login ?? "",
    }));
  }

  // ── Environments ──────────────────────────────────────────────────────────────

  async function fetchEnvs(account: Account, repo: string): Promise<GhEnv[]> {
    const res = await gh(`/repos/${account.login}/${repo}/environments?per_page=100`);
    if (!res.ok) throw new Error(`Failed to fetch environments: ${res.status}`);
    const data = await res.json();
    return (data.environments ?? []).map((e: { name: string; id: number; url: string }) => ({
      name: e.name,
      id: e.id,
      url: e.url,
    }));
  }

  // ── Secrets ───────────────────────────────────────────────────────────────────

  async function fetchSecrets(account: Account, repo: string, envName: string): Promise<string[]> {
    const all = await paginate<{ name: string }>(`/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/secrets`);
    return all.map((s) => s.name);
  }

  async function fetchPublicKey(account: Account, repo: string, envName?: string): Promise<{ key: string; keyId: string }> {
    const path = envName
      ? `/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/secrets/public-key`
      : `/repos/${account.login}/${repo}/actions/secrets/public-key`;
    const res = await gh(path);
    if (!res.ok) throw new Error(`Failed to fetch public key: ${res.status}`);
    const data = await res.json();
    return { key: data.key, keyId: data.key_id };
  }

  async function upsertSecret(
    account: Account,
    repo: string,
    name: string,
    encryptedValue: string,
    keyId: string,
    envName?: string
  ): Promise<UpsertSecretResult> {
    const path = envName
      ? `/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/secrets/${name}`
      : `/repos/${account.login}/${repo}/actions/secrets/${name}`;
    const res = await gh(path, {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    });
    if (!res.ok) throw new Error(`Failed to upsert secret "${name}": ${res.status}`);
    return { success: true, name, env: envName ?? "actions" };
  }

  // ── Variables ─────────────────────────────────────────────────────────────────

  async function fetchVariables(account: Account, repo: string, envName: string): Promise<Record<string, string>> {
    const all = await paginate<{ name: string; value: string }>(`/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/variables`);
    return Object.fromEntries(all.map((v) => [v.name, v.value]));
  }

  async function createVariable(account: Account, repo: string, name: string, value: string, envName: string): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/variables`, {
      method: "POST",
      body: JSON.stringify({ name, value }),
    });
    if (!res.ok) throw new Error(`Failed to create variable "${name}": ${res.status}`);
  }

  async function updateVariable(account: Account, repo: string, name: string, value: string, envName: string): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/variables/${name}`, {
      method: "PATCH",
      body: JSON.stringify({ name, value }),
    });
    if (!res.ok) throw new Error(`Failed to update variable "${name}": ${res.status}`);
  }

  async function deleteVariable(account: Account, repo: string, name: string, envName: string): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/environments/${encodeURIComponent(envName)}/variables/${name}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete variable "${name}": ${res.status}`);
  }

  // ── Repo contents ─────────────────────────────────────────────────────────────

  async function fetchStageReport(
    account: Account,
    repo: string,
    envName: string,
    dir: string,
    kind: "plan" | "deploy" | "build",
    perPage: number = 1
  ): Promise<StageReport | null> {
    const params = new URLSearchParams({ environment: envName, task: `${kind}:${dir}`, per_page: perPage.toString() });
    const res = await gh(`/repos/${account.login}/${repo}/deployments?${params}`);
    if (!res.ok) throw new Error(`Failed to fetch the report for "${dir}": ${res.status}`);
    const [latest] = (await res.json()) as { payload: unknown; created_at: string; sha?: string }[];
    console.log(`🚧Fetched stage report for "${dir}" in env "${envName}":`, latest);
    return latest ? toStageReport(latest.payload, latest.created_at, latest.sha) : null;
  }

  async function fetchEnv(account: Account, repo: string): Promise<Record<string, string> | null> {
    const res = await gh(`/repos/${account.login}/${repo}/contents/corpSetup/corp.env`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to fetch env: ${res.status}`);
    const data = await res.json();
    return parse(decodeContent(data.content));
  }

  // ── Artifacts ─────────────────────────────────────────────────────────────────
  //TODO:getPlanEnv, fetchLogArtifact, fetchPlan need to replace downloadZip with fetchArtifactZip
  async function getPlanEnv(account: Account, repo: string, envId: number): Promise<Record<string, string> | null> {
    try {
      const zip = await downloadZip(account, repo, envId);
      const file = zip.file("corp.env");
      return file ? parse(await file.async("string")) : null;
    } catch {
      return null;
    }
  }

  // Any single-file log artifact — the plan and deploy paths both publish one.
  async function fetchLogArtifact(account: Account, repo: string, logId: number): Promise<string | null> {
    try {
      const zip = await downloadZip(account, repo, logId);
      const file = Object.values(zip.files).find((f) => !f.dir);
      return file ? file.async("string") : null;
    } catch {
      return null;
    }
  }

  async function fetchPlan(id: string, account: Account, repo: string) {
    const zip = await downloadZip(account, repo, Number(id));
    const fileName = Object.keys(zip.files).find((f) => f.endsWith(".json"));
    if (!fileName) throw new Error("No JSON file found in artifact zip");
    return JSON.parse(await zip.file(fileName)!.async("string"));
  }

  // ── Workflow dispatch ─────────────────────────────────────────────────────────

  // Opts the repo into GitHub's immutable OIDC subject, so the sub claim carries owner/repo ids.
  async function setOidcImmutableSubject(account: Account, repo: string): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/actions/oidc/customization/sub`, {
      method: "PUT",
      body: JSON.stringify({
        use_default: false,
        include_claim_keys: ["repo", "environment"],
        use_immutable_subject: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to set OIDC subject: ${res.status} ${body}`);
    }
  }

  async function triggerWorkflow(account: Account, repo: string, workflowId: string, githubEnvName: string, ref: string): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref, inputs: { github_env_name: githubEnvName } }),
    });
    if (!res.ok) throw new Error(`Failed to trigger workflow: ${res.status}`);
  }

  async function triggerWorkflowFromPR(account: Account, repo: string, workflowId: string, githubEnvName: string, commitSha: string): Promise<void> {
    return triggerWorkflow(account, repo, workflowId, githubEnvName, commitSha);
  }
  // Hands the workflow the session the browser already registered, never the access token.
  async function triggerRemoteLogin(account: Account, repo: string, opts: RemoteLoginDispatch): Promise<void> {
    const res = await gh(`/repos/${account.login}/${repo}/actions/workflows/${opts.workflowId}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: opts.ref,
        inputs: {
          github_env_name: opts.githubEnvName,
          session_id: opts.sessionId,
          dir: opts.dir,
          plan_run_id: opts.planRunId,
        },
      }),
    });
    if (!res.ok) throw new Error(`Failed to start the remote login workflow: ${res.status}`);
  }

  return {
    verifyAuth,
    fetchOrgList,
    fetchRepos,
    checkTemplate,
    generateRepo,
    fetchBranches,
    createBranch,
    fetchPullRequests,
    fetchRuns,
    fetchEnvs,
    fetchSecrets,
    fetchPublicKey,
    upsertSecret,
    fetchVariables,
    createVariable,
    updateVariable,
    deleteVariable,
    fetchStageReport,
    fetchArtifactZip,
    setOidcImmutableSubject,
    fetchEnv,
    getPlanEnv,
    fetchLogArtifact,
    fetchPlan,
    triggerWorkflow,
    triggerWorkflowFromPR,
    triggerRemoteLogin,
  };
}

export type ApiProvider = ReturnType<typeof createGithubApi>;
