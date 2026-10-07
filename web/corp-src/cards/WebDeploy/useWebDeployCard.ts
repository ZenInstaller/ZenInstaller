/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from "react";
import JSZip from "jszip";
import { fetchArtifactZip, fetchStageReport, triggerWorkflow } from "../../api";
import { getStaticWebsiteUrl } from "../../api/azureArm";
import { readDeployedSite, recordDeployedSite, uploadStaticSite, type DeployedSite } from "../../api/azureBlob";
import { getWebStorageAccountName } from "../../logic/naming";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import type { Account, AzureConfigHook, CardHook, CardRequirements, CardStatus, GhEnv } from "../../types";

// What the build workflow recorded, as the card reads it back off the Deployments API.
type WebBuild = {
  version: string;
  sha: string;
  runId: string;
  artifactId: number | null;
  builtAt: number;
  // What the workflow baked in, so drift since then is visible without rebuilding to find out.
  vars?: Record<string, string>;
};

export interface UseWebDeployCardParams {
  azureAccount: import("../../types").AzureAccount | null;
  subscriptionId: string;
  tenantId?: string;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variableValues: Record<string, string>;
}

const BUILD_WORKFLOW = "buildFrontend.yml";

export interface UseWebDeployCard extends CardHook, AzureConfigHook {
  readonly cardId: "web_deploy";
  storageAccountName: string;
  siteUrl: string | null;
  latest: WebBuild | null;
  deployed: DeployedSite | null;
  loadingDeployed: boolean;
  loadingLatest: boolean;
  building: boolean;
  build: () => Promise<void>;
  buildWorkflow: string;
  updateAvailable: boolean;
  // The built site bakes this in, so a build without it ships a broken sign-in.
  missingGithubClientId: boolean;
  // Variables whose value no longer matches what the latest build used.
  staleVariables: string[];
  error: string | null;
  cardRequirements: CardRequirements;
  cardDependencyLabel: string;
}

// The build takes a couple of minutes; these are the gaps between checks for its report.
const POLL_DELAYS_MS = [30_000, 30_000, 45_000, 60_000, 60_000, 90_000];

/*
 * The frontend half of Private Zeninstaller Backend: the workflow builds the site, this card
 * downloads that artifact and writes the files into the $web container itself. What is live is
 * kept on the container's metadata, so a build already up there is not uploaded twice.
 */
export function useWebDeployCard({
  azureAccount,
  subscriptionId,
  tenantId,
  githubAccount,
  repoName,
  selectedEnv,
  variableValues,
}: UseWebDeployCardParams): UseWebDeployCard {
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const [latest, setLatest] = useState<WebBuild | null>(null);
  const [deployed, setDeployed] = useState<DeployedSite | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [loadingDeployed, setLoadingDeployed] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storageAccountName = variableValues.SITE_STORAGE_ACCOUNT || getWebStorageAccountName(subscriptionId);
  const missingGithubClientId = !(variableValues.VITE_GITHUB_CLIENT_ID ?? "").trim();
  const ready = !!azureAccount && !!githubAccount && !!repoName && !!selectedEnv && !missingGithubClientId;

  const readLatest = useCallback(async (): Promise<WebBuild | null> => {
    if (!githubAccount || !repoName || !selectedEnv) return null;
    const report = await fetchStageReport(githubAccount, repoName, selectedEnv.name, "frontend", "build");
    return (report?.stage as unknown as WebBuild) ?? null;
  }, [githubAccount, repoName, selectedEnv]);

  useEffect(() => {
    if (!githubAccount || !repoName || !selectedEnv) return;
    let cancelled = false;
    void (async () => {
      setLoadingLatest(true);
      try {
        const b = await readLatest();
        if (!cancelled) setLatest(b);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read the latest build");
      } finally {
        if (!cancelled) setLoadingLatest(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [githubAccount, repoName, selectedEnv, readLatest]);

  const readDeployed = useCallback(async () => {
    if (!azureAccount || !storageAccountName || !subscriptionId) return;
    setLoadingDeployed(true);
    try {
      // Before the environment card runs there is no account to ask, which is not an error here.
      const url = await getStaticWebsiteUrl(azureAccount, subscriptionId, storageAccountName, tenantId);
      setSiteUrl(url);
      setDeployed(url ? await readDeployedSite(azureAccount, storageAccountName, tenantId) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read what is live");
    } finally {
      setLoadingDeployed(false);
    }
  }, [azureAccount, subscriptionId, storageAccountName, tenantId]);

  // Deferred so the loading flag is not set during the render that schedules this.
  useEffect(() => {
    const t = setTimeout(() => void readDeployed(), 0);
    return () => clearTimeout(t);
  }, [readDeployed]);

  const build = useCallback(async () => {
    if (!githubAccount || !repoName || !selectedEnv) return;
    setBuilding(true);
    setError(null);
    const before = latest?.builtAt ?? 0;
    try {
      await triggerWorkflow(githubAccount, repoName, BUILD_WORKFLOW, selectedEnv.name, selectedEnv.name);
      for (const delay of POLL_DELAYS_MS) {
        await new Promise((r) => setTimeout(r, delay));
        const next = await readLatest();
        if (next && next.builtAt > before) {
          setLatest(next);
          return;
        }
      }
      setError("The build is taking longer than expected — check GitHub Actions.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start the build");
    } finally {
      setBuilding(false);
    }
  }, [githubAccount, repoName, selectedEnv, latest, readLatest]);

  const run = useCallback(async () => {
    if (!azureAccount || !githubAccount || !repoName || !latest || !storageAccountName) return;
    if (latest.artifactId == null) {
      setError("The latest build did not publish a site artifact.");
      return;
    }
    setRunning(true);
    setError(null);
    setSteps([
      { id: "download", label: "Download the built site", status: "pending" },
      { id: "unpack", label: "Unpack it", status: "pending" },
      { id: "upload", label: `Upload it to ${storageAccountName}`, status: "pending" },
    ]);
    try {
      updateStep("download", "running");
      const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
      const zip = await fetchArtifactZip(githubAccount, repoName, latest.artifactId, (received, total) =>
        updateStep("download", "running", total ? `${mb(received)} / ${mb(total)} MB` : `${mb(received)} MB`, total ? received / total : undefined)
      );
      updateStep("download", "done", `${mb(zip.size)} MB`);

      updateStep("unpack", "running");
      const archive = await JSZip.loadAsync(zip);
      const files = await Promise.all(
        Object.values(archive.files)
          .filter((f) => !f.dir)
          .map(async (f) => ({ path: f.name, body: await f.async("blob") }))
      );
      if (files.length === 0) throw new Error("The artifact contained no files");
      updateStep("unpack", "done", `${files.length} files`);

      updateStep("upload", "running");
      await uploadStaticSite(azureAccount, storageAccountName, files, tenantId, (uploaded, total) =>
        updateStep("upload", "running", `${uploaded} / ${total} files`, uploaded / total)
      );
      updateStep("upload", "done", `${files.length} files`);

      // Recorded on the container rather than in this browser, so any machine sees what is live.
      await recordDeployedSite(azureAccount, storageAccountName, { version: latest.version, sha: latest.sha, builtAt: latest.builtAt }, tenantId);
      await readDeployed();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error", detail: message } : s)));
    } finally {
      setRunning(false);
    }
  }, [azureAccount, githubAccount, repoName, latest, storageAccountName, tenantId, readDeployed, setRunning, setSteps, updateStep]);

  const reset = useCallback(() => {
    resetSteps();
    setError(null);
    void readDeployed();
  }, [resetSteps, readDeployed]);

  // Compared on version
  const staleVariables = Object.entries(latest?.vars ?? {})
    .filter(([key, builtWith]) => (variableValues[key] ?? "") !== builtWith)
    .map(([key]) => key);

  const done = !!deployed && !!latest && deployed.version === latest.version;
  const updateAvailable = !!latest && !done;

  const status: CardStatus = !ready ? "idle" : done ? "complete" : "warning";
  const summary = missingGithubClientId
    ? "Set VITE_GITHUB_CLIENT_ID first"
    : !ready
      ? "Unavailable"
      : done
        ? `Deployed ${latest?.sha.slice(0, 7)}`
        : updateAvailable
          ? "Update available"
          : "Build the frontend";

  return {
    cardId: "web_deploy" as const,
    storageAccountName,
    siteUrl,
    latest,
    deployed,
    loadingDeployed,
    loadingLatest,
    building,
    build,
    buildWorkflow: BUILD_WORKFLOW,
    updateAvailable,
    missingGithubClientId,
    staleVariables,
    error,
    steps,
    running,
    done,
    status,
    summary,
    run,
    reset,
    cardRequirements: ["github_login", "repo", "azure_login", "private_frontend_infra"],
    cardDependencyLabel: "Deploy the frontend",
  };
}
