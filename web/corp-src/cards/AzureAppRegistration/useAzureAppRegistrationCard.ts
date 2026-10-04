/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from "react";
import { ensureScopeConsent, getMsal } from "../../auth/msal";
import { APP_SCOPES, AZURE_CLIENT_ID } from "../../config/azureConfig";
import {
  getExistingApp,
  getAppNameByAppId,
  createAppRegistration,
  getExistingSP,
  createServicePrincipal,
  ensureFederatedCredential,
  ensureRbacRole,
} from "../../api/azureGraph";
import { isConsentError } from "../../logic/consent";
import { createResultStorage } from "../../logic/resultStorage";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import { useRbacCheck, type RbacCheckStatus } from "./useRbacCheck";
import type { Account, AzureAccount, AzureConfigHook, AzureTarget, CardHook, CardRequirements, CardStatus, SetupStep } from "../../types";
import { VALID_ENVS } from "../../config/githubConfig";
import { getFederatedCredential, getImmutableRepoSegment } from "../../logic/naming";
import { setOidcImmutableSubject } from "../../api";

export type AzureAppRegistrationResult = { clientId: string; tenantId: string; subscriptionIds: string[] };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAzureAppRegistrationCardParams extends AzureTarget {
  githubAccount: Account | null;
  githubRepo: string;
  githubRepoId: number | null; // GitHub's numeric repo id — needed for the immutable OIDC subject.
  variableValues: Record<string, string>; // githubVariables.values — reads AZURE_CLIENT_ID / AZURE_PLAN_CLIENT_ID.
  manualTenantId: string; // azure.manualTenantId — last-resort tenant fallback before any saved/result tenant exists.
  subscriptionLabel?: string; // Display name for the target subscription — shown on the RBAC step; falls back to the id.
}

// steps / running / run / reset come from AzureConfigHook.
export interface UseAzureAppRegistrationCard extends CardHook, AzureConfigHook {
  readonly cardId: "azure_app_registration";
  azureAccount: AzureAccount | null;
  appName: string;
  setAppName: (name: string) => void;
  environments: string[];
  setEnvironments: (envs: string[]) => void;
  result: AzureAppRegistrationResult | null;
  runNonce: number; // Bumped on each successful run — the card uses it to auto-save the connection variables.
  prefillAppName: (appId: string) => Promise<void>;
  spClientId: string;
  tenantId?: string; // The resolved effective tenant — fed to useCoreInfraCard / useCreateDomainCard.
  rbacStatus: RbacCheckStatus;
  rbacMissingRoles: string[];
  planClientIdMismatch: boolean; // AZURE_PLAN_CLIENT_ID has drifted from AZURE_CLIENT_ID (the app's own flow always keeps them equal).
  variablesComplete: boolean; // Both AZURE_APP_KEYS are saved on GitHub — reported by CloudVariableDetail via onVariablesComplete.
  onVariablesComplete: (complete: boolean) => void;
  // Narrowed from CardHook (optional there) — every card provides these.
  cardRequirements: CardRequirements;
  cardDependencyLabel: string; // Label for the dependency that this card provides to others (e.g. "Complete the Azure app registration")
}

const RESULT_KEY = "zeninstaller_azure_result";

const { save: saveResult, load: loadResult } = createResultStorage<AzureAppRegistrationResult>(RESULT_KEY);

/*
 * The GitHub Actions app registration: create the app + service principal, federate it to
 * the repo's environments, and grant it RBAC on the target subscription. The Azure session
 * and the subscription pick live in useAzureAccount / useAzureSubscriptionCard — this card locks
 * behind both, so the account and subscription it's handed are already confirmed.
 *
 * Also owns the live RBAC check (useRbacCheck) and the "connection variables saved" flag —
 * both used to be held in App.tsx and re-injected into this card's `done` after the fact;
 * pulling them in here means `done` has exactly one definition, computed once.
 */
export function useAzureAppRegistrationCard({
  azureAccount,
  githubAccount,
  githubRepo,
  githubRepoId,
  subscriptionId,
  subscriptionLabel,
  tenantId,
  variableValues,
  manualTenantId,
}: UseAzureAppRegistrationCardParams): UseAzureAppRegistrationCard {
  const [appName, setAppName] = useState("zeninstaller-github");
  const defaultSelected = ["PROD", "TEST"].filter((e) => VALID_ENVS.includes(e));
  const [environments, setEnvironments] = useState<string[]>(defaultSelected.length > 0 ? defaultSelected : ["PROD", "TEST"]);
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const [result, setResult] = useState<AzureAppRegistrationResult | null>(loadResult);
  const [variablesComplete, setVariablesComplete] = useState(false);
  // Incremented on each successful run. Distinguishes "a run just finished" from "result exists",
  // which a persisted result makes indistinguishable on reload.
  const [runNonce, setRunNonce] = useState(0);
  // "subscriptionId|tenantId|clientId" that the last successful run granted the RBAC roles on.
  const [grantedFor, setGrantedFor] = useState<string | null>(null);

  // MSA (personal) accounts sign in via the consumer tenant, so the real AAD tenant is resolved
  // from whichever of these is known: the saved GitHub var, a prior successful run, or the tenant
  // the user has picked but not yet confirmed via a run.
  const effectiveTenantId = tenantId || result?.tenantId || manualTenantId.trim() || undefined;

  // The app's own save flow always writes AZURE_PLAN_CLIENT_ID equal to AZURE_CLIENT_ID — a saved
  // mismatch means something else touched it (stale value, manual edit), so treat it as drift too.
  const spClientId = variableValues.AZURE_CLIENT_ID || result?.clientId || "";
  const planClientId = variableValues.AZURE_PLAN_CLIENT_ID || result?.clientId || "";
  const planClientIdMismatch = !!spClientId && !!planClientId && spClientId !== planClientId;

  // Live check: does the app reg exist in this tenant, and does its SP hold RBAC on the selected subscription?
  const { status: liveRbacStatus, missingRoles: liveRbacMissingRoles } = useRbacCheck({
    azureAccount,
    spClientId,
    subscriptionId,
    tenantId: effectiveTenantId,
  });

  const grantKey = `${subscriptionId}|${effectiveTenantId ?? ""}|${spClientId}`;
  const rbacTrusted = !!subscriptionId && !!spClientId && grantedFor === grantKey;
  const rbacStatus = rbacTrusted ? "ready" : liveRbacStatus;
  const rbacMissingRoles = rbacTrusted ? [] : liveRbacMissingRoles;

  // Resolve the app registration's display name from a known client id and prefill appName.
  const prefillAppName = useCallback(
    async (appId: string) => {
      if (!azureAccount || !appId) return;
      try {
        const name = await getAppNameByAppId(azureAccount, appId, effectiveTenantId);
        if (name) setAppName(name);
      } catch {
        /* keep default name */
      }
    },
    [azureAccount, effectiveTenantId]
  );

  const reset = useCallback(() => {
    resetSteps();
    setResult(null);
    saveResult(null);
    setGrantedFor(null);
  }, [resetSteps]);

  // Redirects for Application/AppRoleAssignment.ReadWrite.All incremental consent; user re-runs after returning.
  const requestAppConsent = useCallback(async () => {
    if (!azureAccount) return;
    const msal = await getMsal();
    if (!msal) return;
    await msal.acquireTokenRedirect({
      scopes: APP_SCOPES,
      account: azureAccount,
      authority: `https://login.microsoftonline.com/${effectiveTenantId || azureAccount.tenantId}`,
    });
  }, [azureAccount, effectiveTenantId]);

  const run = useCallback(async () => {
    if (!azureAccount || !subscriptionId || !githubAccount) return;
    setRunning(true);

    const org = githubAccount.login;
    const resolvedTenantId = effectiveTenantId ?? azureAccount.tenantId;

    const initialSteps: SetupStep[] = [
      { id: "consent", label: "Confirm Microsoft permissions", status: "pending" },
      { id: "app", label: "Create app registration", status: "pending" },
      { id: "sp", label: "Create service principal", status: "pending" },
      { id: "oidc", label: "Switch GitHub OIDC to immutable subject", status: "pending" },
      { id: "creds", label: "Add federated credentials", status: "pending" },
      { id: "rbac", label: "Assign RBAC roles", status: "pending" },
    ];
    setSteps(initialSteps);

    let appId = "";
    let appObjectId = "";
    let spObjectId = "";
    let currentStep = "consent";

    try {
      currentStep = "consent";
      updateStep("consent", "running");
      const promptedGraph = await ensureScopeConsent(azureAccount, [...APP_SCOPES], effectiveTenantId);
      updateStep("consent", promptedGraph ? "done" : "skipped", promptedGraph ? undefined : "Already granted");

      currentStep = "app";
      updateStep("app", "running");
      const existing = await getExistingApp(azureAccount, appName, effectiveTenantId);
      if (existing) {
        appId = existing.appId;
        appObjectId = existing.id;
        updateStep("app", "skipped", `Existing: ${appId}`);
      } else {
        // No pipeline-wide app permissions requested up front — cards that need one (e.g. domain) grant it themselves.
        const created = await createAppRegistration(azureAccount, appName, [], effectiveTenantId);
        appId = created.appId;
        appObjectId = created.id;
        updateStep("app", "done", appId);
      }

      currentStep = "sp";
      updateStep("sp", "running");
      const existingSP = await getExistingSP(azureAccount, appId, effectiveTenantId);
      if (existingSP) {
        spObjectId = existingSP.id;
        updateStep("sp", "skipped", "Already exists");
      } else {
        const sp = await createServicePrincipal(azureAccount, appId, effectiveTenantId);
        spObjectId = sp.id;
        updateStep("sp", "done", spObjectId);
      }

      currentStep = "oidc";
      updateStep("oidc", "running");
      if (githubRepoId === null) throw new Error(`Create the repository ${githubRepo} on GitHub before running this`);
      await setOidcImmutableSubject(githubAccount, githubRepo);
      updateStep("oidc", "done", getImmutableRepoSegment(org, githubAccount.id, githubRepo, githubRepoId));

      currentStep = "creds";
      updateStep("creds", "running");
      let added = 0;
      for (const env of environments) {
        const cred = getFederatedCredential(org, githubAccount.id, githubRepo, githubRepoId, env);
        if (await ensureFederatedCredential(azureAccount, appObjectId, cred.name, cred.subject, effectiveTenantId)) {
          added += 1;
        }
      }
      if (added === 0) {
        updateStep("creds", "skipped", `${environments.join(", ")} already exist`);
      } else {
        updateStep("creds", "done", `${environments.join(", ")} — ${added} added`);
      }

      currentStep = "rbac";
      updateStep("rbac", "running");
      await ensureRbacRole(azureAccount, subscriptionId, spObjectId, "Reader", effectiveTenantId);
      updateStep("rbac", "done", subscriptionLabel || subscriptionId);

      const r = { clientId: appId, tenantId: resolvedTenantId, subscriptionIds: [subscriptionId] };
      setResult(r);
      saveResult(r);
      setGrantedFor(`${subscriptionId}|${resolvedTenantId ?? ""}|${appId}`);
      setRunNonce((n) => n + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      if (isConsentError(msg)) {
        updateStep(currentStep, "error", "Additional consent required — redirecting to Microsoft...");
        await requestAppConsent().catch(() => updateStep(currentStep, "error", "Consent redirect failed — try again"));
      } else {
        updateStep(currentStep, "error", msg);
      }
    } finally {
      setRunning(false);
    }
  }, [
    azureAccount,
    subscriptionId,
    subscriptionLabel,
    effectiveTenantId,
    githubAccount,
    githubRepo,
    githubRepoId,
    appName,
    environments,
    setSteps,
    setRunning,
    updateStep,
    requestAppConsent,
  ]);

  const done = variablesComplete && rbacStatus === "ready" && !planClientIdMismatch;

  const azureConfigured = !!AZURE_CLIENT_ID;
  // Assumes prerequisites are met — App locks this card (via cardRequirements) whenever they're not,
  // which overrides this status to "idle" regardless of what's computed here.
  const status: CardStatus = !azureConfigured
    ? "error"
    : !variablesComplete
      ? "warning"
      : rbacStatus === "sp-not-found" || rbacStatus === "missing-role" || planClientIdMismatch
        ? "warning" // vars saved but the app reg is gone from this tenant, the SP lost access, or AZURE_PLAN_CLIENT_ID drifted
        : "complete"; // filled in — validated (true) or not yet run (null) both count as complete
  const summary = !azureConfigured
    ? "Unavailable"
    : rbacStatus === "sp-not-found"
      ? "Not found in the selected tenant — recreate it"
      : rbacStatus === "missing-role"
        ? "Missing access on the selected subscription"
        : planClientIdMismatch
          ? "AZURE_PLAN_CLIENT_ID doesn't match AZURE_CLIENT_ID"
          : result
            ? "App registration ready"
            : "Create the app registration";

  return {
    cardId: "azure_app_registration" as const,
    azureAccount,
    appName,
    setAppName,
    environments,
    setEnvironments,
    steps,
    result,
    runNonce,
    running,
    reset,
    run,
    prefillAppName,
    spClientId,
    tenantId: effectiveTenantId,
    rbacStatus,
    rbacMissingRoles,
    planClientIdMismatch,
    variablesComplete,
    onVariablesComplete: setVariablesComplete,
    status,
    summary,
    cardRequirements: ["github_login", "azure_login", "repo", "azure_subscription"],
    cardDependencyLabel: "Complete the Azure app registration",
    done,
  };
}
