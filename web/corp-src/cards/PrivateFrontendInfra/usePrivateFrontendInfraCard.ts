/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from "react";
import {
  ensureBlobServiceProperties,
  ensureRbacRoleAtScope,
  ensureBlobDiagnostics,
  ensureLogAnalyticsWorkspace,
  ensureResourceGroup,
  resourceGroupExists,
  findStorageAccountGroup,
  storageAccountNameAvailable,
  ensureSubscriptionDiagnostics,
  listLocations,
  type AzureLocation,
  ensureStorageAccount,
  getStaticWebsiteUrl,
  storageAccountScope,
} from "../../api/azureArm";
import { createSpaAppRegistration, createServicePrincipal, ensureSpaRedirectUri, getExistingApp, getExistingSP } from "../../api/azureGraph";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import { useProviderRegistration } from "../../hooks/util/useProviderRegistration";
import {
  DEFAULT_AZURE_LOCATION,
  DIAGNOSTIC_SETTING_NAME,
  getPrivateInstallerAppName,
  PRIVATE_LOG_ANALYTICS,
  PRIVATE_RESOURCE_GROUP,
  getWebStorageAccountName,
} from "../../logic/naming";
import { PRIVATE_INSTALLER_DELEGATED, PRIVATE_FRONTEND_PROVIDERS, STORAGE_SCOPES } from "../../config/azureConfig";
import { ensureScopeConsent } from "../../auth/msal";
import { createResultStorage } from "../../logic/resultStorage";
import type { AzureConfigHook, AzureTarget, CardHook, CardStatus, SetupStep } from "../../types";

export type PrivateFrontendInfraResult = {
  subscriptionId: string;
  siteStorageAccount: string;
  tenantId: string;
  installerClientId: string;
};

export interface UsePrivateFrontendInfraCardParams extends AzureTarget {
  variableValues: Record<string, string>;
  // Origins the browser calls /register and /negotiate from; without them every session fails on CORS.
  allowedOrigins: string[];
}

export interface UsePrivateFrontendInfraCard extends CardHook, AzureConfigHook {
  readonly cardId: "private_frontend_infra";
  location: string;
  setLocation: (loc: string) => void;
  siteStorageAccount: string;
  setSiteStorageAccount: (name: string) => void;
  siteStorageChecking: boolean;
  siteStorageError: string | null;
  checkSiteStorageAccount: () => Promise<boolean>;
  locations: AzureLocation[];
  locationsLoading: boolean;
  locationsError: string | null;
  resourceGroupName: string;
  lawName: string;
  webStorageAccountName: string;
  result: PrivateFrontendInfraResult | null;
  resultMatches: boolean;
  runNonce: number;
}

const RESULT_KEY = "zeninstaller_private_env_result";
const { save: saveResult, load: loadResult } = createResultStorage<PrivateFrontendInfraResult>(RESULT_KEY);

// Everything the private installer site needs before it can be built and uploaded, created from the
// browser rather than Terraform: the group, the workspace it logs to, the storage account that serves
// the site, and the app registration users sign in to.
export function usePrivateFrontendInfraCard({
  azureAccount,
  subscriptionId,
  tenantId,
  allowedOrigins,
  variableValues,
}: UsePrivateFrontendInfraCardParams): UsePrivateFrontendInfraCard {
  const [location, setLocation] = useState(DEFAULT_AZURE_LOCATION);
  const [locations, setLocations] = useState<AzureLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const { ensureRegistered } = useProviderRegistration({ azureAccount, subscriptionId, tenantId });
  const [result, setResult] = useState<PrivateFrontendInfraResult | null>(loadResult);
  const [runNonce, setRunNonce] = useState(0);

  const resourceGroupName = PRIVATE_RESOURCE_GROUP;
  const lawName = PRIVATE_LOG_ANALYTICS;
  /*
   * Derived from the subscription so it is unique and the same on every re-run. The name is global
   * to Azure, so when another tenant already holds it the field is the way out: type another one.
   */
  const [siteStorageOverride, setSiteStorageOverride] = useState("");
  const [siteStorageChecking, setSiteStorageChecking] = useState(false);
  const [siteStorageError, setSiteStorageError] = useState<string | null>(null);
  const webStorageAccountName = siteStorageOverride || variableValues.SITE_STORAGE_ACCOUNT || getWebStorageAccountName(subscriptionId);

  const resultMatches = !!result && result.subscriptionId === subscriptionId;

  /*
   * Completion is read back from the things themselves: the group and the site's account from Azure,
   * the client id from the GitHub environment. A record in this browser proves none of them exist.
   */
  const [rgExists, setRgExists] = useState(false);
  const [storageExists, setStorageExists] = useState(false);
  const done = rgExists && storageExists && !!variableValues.VITE_AZURE_CLIENT_ID;
  const azureConfigured = !!azureAccount && !!subscriptionId;

  const reset = useCallback(() => {
    resetSteps();
    setResult(null);
    saveResult(null);
  }, [resetSteps]);

  useEffect(() => {
    if (!azureAccount || !subscriptionId) {
      setRgExists(false);
      setStorageExists(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [rg, storage] = await Promise.all([
        resourceGroupExists(azureAccount, subscriptionId, resourceGroupName, tenantId).catch(() => false),
        findStorageAccountGroup(azureAccount, subscriptionId, webStorageAccountName, tenantId).catch(() => null),
      ]);
      if (cancelled) return;
      setRgExists(rg);
      setStorageExists(!!storage);
    })();
    return () => {
      cancelled = true;
    };
  }, [azureAccount, subscriptionId, tenantId, resourceGroupName, webStorageAccountName, runNonce]);

  const setSiteStorageAccount = useCallback((name: string) => {
    setSiteStorageOverride(name);
    setSiteStorageError(
      name.length > 24 ? `${name.length} characters; Azure allows 24` : /^[a-z0-9]*$/.test(name) ? null : "Lowercase letters and digits only"
    );
  }, []);

  // An account this subscription can see is the customer's own, so it is reused wherever it lives.
  const checkSiteStorageAccount = useCallback(async (): Promise<boolean> => {
    const name = webStorageAccountName;
    if (!/^[a-z0-9]{3,24}$/.test(name)) {
      setSiteStorageError("3-24 characters, lowercase letters and digits only");
      return false;
    }
    if (!azureAccount || !subscriptionId) return true;

    setSiteStorageChecking(true);
    setSiteStorageError(null);
    try {
      if (await findStorageAccountGroup(azureAccount, subscriptionId, name, tenantId)) return true;
      if (await storageAccountNameAvailable(azureAccount, subscriptionId, name, tenantId)) return true;
      setSiteStorageError("This name is taken somewhere in Azure — choose a different one");
      return false;
    } catch (e) {
      setSiteStorageError(e instanceof Error ? e.message : "Could not check the name");
      return false;
    } finally {
      setSiteStorageChecking(false);
    }
  }, [azureAccount, subscriptionId, tenantId, webStorageAccountName]);

  // Load the subscription's available regions once an account + subscription are known.
  useEffect(() => {
    if (!azureAccount || !subscriptionId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    setLocationsLoading(true);
    setLocationsError(null);
    listLocations(azureAccount, subscriptionId, tenantId)
      .then((locs) => {
        if (!cancelled) setLocations(locs);
      })
      .catch((err) => {
        if (!cancelled) setLocationsError(err instanceof Error ? err.message : "Failed to load Azure regions");
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [azureAccount, subscriptionId, tenantId]);

  const run = useCallback(async () => {
    if (!azureAccount || !subscriptionId) return;
    if (webStorageAccountName.length > 24) {
      setSteps([
        {
          id: "name",
          label: "Check resource names",
          status: "error",
          detail: `Storage account name "${webStorageAccountName}" is ${webStorageAccountName.length} characters; Azure allows 24`,
        },
      ]);
      return;
    }

    setRunning(true);
    const initialSteps: SetupStep[] = [
      { id: "providers", label: "Register required Azure resource providers", status: "pending" },
      { id: "rg", label: `Create resource group ${resourceGroupName}`, status: "pending" },
      { id: "law", label: `Create Log Analytics workspace ${lawName}`, status: "pending" },
      { id: "webStorage", label: `Create storage account ${webStorageAccountName}`, status: "pending" },
      { id: "webBlob", label: "Enable static website hosting and reach the blob service", status: "pending" },
      { id: "webConsent", label: "Consent to the storage data plane", status: "pending" },
      { id: "webRbac", label: "Grant yourself Storage Blob Data Contributor on it", status: "pending" },
      { id: "diagnostics", label: "Send activity and blob writes to the workspace", status: "pending" },
      { id: "installerApp", label: `Create app registration ${getPrivateInstallerAppName()}`, status: "pending" },
      {
        id: "installerSp",
        label: `List ${getPrivateInstallerAppName()} under enterprise applications`,
        status: "pending",
      },
    ];
    setSteps(initialSteps);

    const mark = (id: string, r: "created" | "exists") => updateStep(id, r === "exists" ? "skipped" : "done", r === "exists" ? "Already exists" : undefined);

    try {
      updateStep("providers", "running");
      const providers = await ensureRegistered(PRIVATE_FRONTEND_PROVIDERS);
      updateStep(
        "providers",
        providers.registered.length === 0 ? "skipped" : "done",
        providers.registered.length === 0 ? "Already registered" : providers.registered.join(", ")
      );

      updateStep("rg", "running");
      mark("rg", await ensureResourceGroup(azureAccount, subscriptionId, resourceGroupName, location, tenantId));

      updateStep("law", "running");
      const law = await ensureLogAnalyticsWorkspace(azureAccount, subscriptionId, resourceGroupName, lawName, location, tenantId);
      mark("law", law.result);

      // Storage account names are global, so one that already exists has to be used where it is.
      const storageGroup = (await findStorageAccountGroup(azureAccount, subscriptionId, webStorageAccountName, tenantId)) ?? resourceGroupName;

      updateStep("webStorage", "running");
      mark("webStorage", await ensureStorageAccount(azureAccount, subscriptionId, storageGroup, webStorageAccountName, location, tenantId));

      updateStep("webBlob", "running");
      await ensureBlobServiceProperties(azureAccount, subscriptionId, storageGroup, webStorageAccountName, allowedOrigins, tenantId);
      updateStep("webBlob", "done", allowedOrigins.join(", "));

      // Navigates away when consent is missing, so nothing below runs until the user comes back.
      updateStep("webConsent", "running");
      const promptedStorage = await ensureScopeConsent(azureAccount, [...STORAGE_SCOPES], tenantId);
      if (promptedStorage) return;
      updateStep("webConsent", "skipped", "Already granted");

      // Owner does not reach the blob data plane, so the browser needs this to upload the built site.
      updateStep("webRbac", "running");
      mark(
        "webRbac",
        await ensureRbacRoleAtScope(
          azureAccount,
          storageAccountScope(subscriptionId, storageGroup, webStorageAccountName),
          azureAccount.localAccountId,
          "Storage Blob Data Contributor",
          tenantId,
          "User"
        )
      );

      // Audit trail: who touched the subscription, and who rewrote the site's contents.
      updateStep("diagnostics", "running");
      const activity = await ensureSubscriptionDiagnostics(azureAccount, subscriptionId, DIAGNOSTIC_SETTING_NAME, law.id, tenantId);
      const blobLogs = await ensureBlobDiagnostics(
        azureAccount,
        subscriptionId,
        storageGroup,
        webStorageAccountName,
        DIAGNOSTIC_SETTING_NAME,
        law.id,
        tenantId
      );
      mark("diagnostics", activity === "exists" && blobLogs === "exists" ? "exists" : "created");

      // The redirect uri is the site this card just created, so the app is registered after it.
      updateStep("installerApp", "running");
      const siteUrl = await getStaticWebsiteUrl(azureAccount, subscriptionId, webStorageAccountName, tenantId);
      if (!siteUrl) throw new Error("The site's web endpoint is not available yet");
      const existingInstaller = await getExistingApp(azureAccount, getPrivateInstallerAppName(), tenantId);
      const installerApp =
        existingInstaller ?? (await createSpaAppRegistration(azureAccount, getPrivateInstallerAppName(), [siteUrl], PRIVATE_INSTALLER_DELEGATED, tenantId));
      // An app created just now already carries the uri; an older one predates this storage account.
      const addedUri = existingInstaller ? await ensureSpaRedirectUri(azureAccount, existingInstaller.id, siteUrl, tenantId) : false;
      if (addedUri) updateStep("installerApp", "done", `Added redirect URI ${siteUrl}`);
      else mark("installerApp", existingInstaller ? "exists" : "created");

      // Without a service principal the app has no enterprise application entry, so there is nothing
      // for an administrator to consent to and nothing to hold a permission grant.
      updateStep("installerSp", "running");
      const existingInstallerSp = await getExistingSP(azureAccount, installerApp.appId, tenantId);
      if (!existingInstallerSp) await createServicePrincipal(azureAccount, installerApp.appId, tenantId);
      mark("installerSp", existingInstallerSp ? "exists" : "created");

      const finished: PrivateFrontendInfraResult = {
        subscriptionId,
        siteStorageAccount: webStorageAccountName,
        tenantId: tenantId || azureAccount.tenantId,
        installerClientId: installerApp.appId,
      };
      setResult(finished);
      saveResult(finished);
      setRunNonce((n) => n + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error", detail: message } : s)));
    } finally {
      setRunning(false);
    }
  }, [
    allowedOrigins,
    lawName,
    resourceGroupName,
    azureAccount,
    ensureRegistered,
    location,
    setRunning,
    setSteps,
    subscriptionId,
    tenantId,
    updateStep,
    webStorageAccountName,
  ]);

  const status: CardStatus = !azureConfigured ? "error" : done ? "complete" : "warning";
  const summary = !azureConfigured ? "Unavailable" : done ? "Private environment ready" : "Set up the private environment";

  return {
    cardId: "private_frontend_infra" as const,
    location,
    setLocation,
    siteStorageAccount: webStorageAccountName,
    setSiteStorageAccount,
    siteStorageChecking,
    siteStorageError,
    checkSiteStorageAccount,
    locations,
    locationsLoading,
    locationsError,
    steps,
    running,
    done,
    status,
    summary,
    run,
    reset,
    result,
    resultMatches,
    runNonce,
    resourceGroupName,
    lawName,
    webStorageAccountName,
    cardRequirements: ["azure_login", "azure_subscription"],
    cardDependencyLabel: "Set up the private environment",
  };
}
