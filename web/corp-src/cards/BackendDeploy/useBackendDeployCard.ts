import { useCallback, useEffect, useState } from "react";
import { fetchArtifactZip, fetchStageReport, triggerWorkflow } from "../../api";
import {
  deployZipToFunctionApp,
  fetchDeployedBackend,
  updateFunctionAppSettings,
  type DeployedBackend,
} from "../../api/azureArm";
import { getRootResourceGroupName, getTerminalFunctionAppName } from "../../logic/naming";
import { BACKEND_VERSION_KEYS } from "../../config/azureConfig";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import type { Account, AzureConfigHook, CardHook, CardRequirements, CardStatus, GhEnv } from "../../types";

// What the build workflow recorded, as the card reads it back off the Deployments API.
type BackendBuild = {
  version: string;
  sha: string;
  runId: string;
  artifactId: number | null;
  artifactUrl?: string;
  builtAt: number;
};

export interface UseBackendDeployCardParams {
  azureAccount: import("../../types").AzureAccount | null;
  subscriptionId: string;
  tenantId?: string;
  corpName: string;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
}

export interface UseBackendDeployCard extends CardHook, AzureConfigHook {
  readonly cardId: "backend_deploy";
  appName: string;
  latest: BackendBuild | null;
  deployed: DeployedBackend | null;
  loadingDeployed: boolean;
  loadingLatest: boolean;
  building: boolean;
  build: () => Promise<void>;
  updateAvailable: boolean;
  error: string | null;
  cardRequirements: CardRequirements;
  cardDependencyLabel: string;
}

// The build takes a couple of minutes; these are the gaps between checks for its report.
const POLL_DELAYS_MS = [30_000, 30_000, 45_000, 60_000, 60_000, 90_000];

/*
 * Publishes the corp backend to the terminal relay's Function App: the workflow builds a package,
 * this card downloads that artifact and pushes it to Kudu itself. The sha of what was pushed is
 * remembered, so a package that is already live is not uploaded twice.
 */
export function useBackendDeployCard({
  azureAccount,
  subscriptionId,
  tenantId,
  corpName,
  githubAccount,
  repoName,
  selectedEnv,
}: UseBackendDeployCardParams): UseBackendDeployCard {
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const [latest, setLatest] = useState<BackendBuild | null>(null);
  const [deployed, setDeployed] = useState<DeployedBackend | null>(null);
  const [loadingDeployed, setLoadingDeployed] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appName = corpName ? getTerminalFunctionAppName(corpName) : "";
  const resourceGroup = corpName ? getRootResourceGroupName(corpName) : "";
  const ready = !!azureAccount && !!githubAccount && !!repoName && !!selectedEnv && !!corpName;

  const readLatest = useCallback(async (): Promise<BackendBuild | null> => {
    if (!githubAccount || !repoName || !selectedEnv) return null;
    const report = await fetchStageReport(githubAccount, repoName, selectedEnv.name, "backend", "build");
    return (report?.stage as unknown as BackendBuild) ?? null;
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
    if (!azureAccount || !appName || !subscriptionId) return;
    setLoadingDeployed(true);
    try {
      setDeployed(
        await fetchDeployedBackend(azureAccount, subscriptionId, resourceGroup, appName, tenantId || undefined),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the deployed version");
    } finally {
      setLoadingDeployed(false);
    }
  }, [azureAccount, subscriptionId, resourceGroup, appName, tenantId]);

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
      await triggerWorkflow(githubAccount, repoName, "buildBackend.yml", selectedEnv.name, selectedEnv.name);
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
    if (!azureAccount || !githubAccount || !repoName || !latest || !appName) return;
    if (latest.artifactId == null) {
      setError("The latest build did not publish a package artifact.");
      return;
    }
    setRunning(true);
    setError(null);
    setSteps([
      { id: "download", label: "Download the built package", status: "pending" },
      { id: "upload", label: `Upload it to ${appName}`, status: "pending" },
      { id: "deploy", label: "Wait for the Function App to unpack it", status: "pending" },
    ]);
    try {
      updateStep("download", "running");
      const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
      const zip = await fetchArtifactZip(githubAccount, repoName, latest.artifactId, (received, total) =>
        updateStep(
          "download",
          "running",
          total ? `${mb(received)} / ${mb(total)} MB` : `${mb(received)} MB`,
          // Undefined without a Content-Length, which leaves the row with text but no bar.
          total ? received / total : undefined,
        ),
      );
      updateStep("download", "done", `${mb(zip.size)} MB`);

      await deployZipToFunctionApp(azureAccount, appName, zip, tenantId, (phase) => {
        if (phase === "uploading") updateStep("upload", "running");
        else {
          updateStep("upload", "done");
          updateStep("deploy", "running");
        }
      });
      updateStep("deploy", "done");

      // Recorded on the app rather than in this browser, so any machine can see what is live.
      await updateFunctionAppSettings(
        azureAccount,
        subscriptionId,
        resourceGroup,
        appName,
        {
          [BACKEND_VERSION_KEYS.version]: latest.version,
          [BACKEND_VERSION_KEYS.sha]: latest.sha,
          [BACKEND_VERSION_KEYS.builtAt]: String(latest.builtAt),
        },
        tenantId || undefined,
      );
      await readDeployed();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error", detail: message } : s)));
    } finally {
      setRunning(false);
    }
  }, [
    azureAccount,
    githubAccount,
    repoName,
    latest,
    appName,
    tenantId,
    readDeployed,
    setRunning,
    setSteps,
    updateStep,
  ]);

  const reset = useCallback(() => {
    resetSteps();
    setError(null);
    void readDeployed();
  }, [resetSteps, readDeployed]);

  // Compared on version
  const done = !!deployed && !!latest && deployed.version === latest.version;
  const updateAvailable = !!latest && !done;

  const status: CardStatus = !ready ? "idle" : done ? "complete" : "warning";
  const summary = !ready
    ? "Unavailable"
    : done
      ? `Deployed ${latest?.sha.slice(0, 7)}`
      : updateAvailable
        ? "Update available"
        : "Build the backend";

  return {
    cardId: "backend_deploy" as const,
    appName,
    latest,
    deployed,
    loadingDeployed,
    loadingLatest,
    building,
    build,
    updateAvailable,
    error,
    steps,
    running,
    done,
    status,
    summary,
    run,
    reset,
    cardRequirements: ["github_login", "repo", "azure_login", "remote_terminal_infra"],
    cardDependencyLabel: "Deploy the backend",
  };
}
