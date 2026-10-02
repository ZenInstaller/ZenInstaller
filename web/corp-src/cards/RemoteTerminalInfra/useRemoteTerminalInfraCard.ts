import { useCallback, useState } from "react";
import {
  appInsightsScope,
  ensureAppInsights,
  ensureFlexFunctionApp,
  ensureFlexServicePlan,
  ensureLogAnalyticsWorkspace,
  ensureBlobCors,
  ensureRbacRoleAtScope,
  ensureResourceGroup,
  ensureStorageAccount,
  getAppInsightsConnectionString,
  getStaticWebsiteUrl,
  ensureStorageContainer,
  ensureStorageTable,
  ensureWebPubSub,
  ensureWebPubSubHub,
  servicePlanId,
  storageAccountScope,
  webPubSubScope,
} from "../../api/azureArm";
import {
  createAppRegistration,
  createSpaAppRegistration,
  createServicePrincipal,
  ensureFederatedCredential,
  getExistingApp,
  getExistingSP,
} from "../../api/azureGraph";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import { useProviderRegistration } from "../../hooks/util/useProviderRegistration";
import { DEFAULT_AZURE_LOCATION } from "../../logic/naming";
import {
  TERMINAL_DEPLOY_CONTAINER,
  TERMINAL_HUB,
  TERMINAL_SESSION_TABLE,
  getTerminalAppInsightsName,
  getTerminalFunctionAppName,
  getTerminalLogAnalyticsWorkspaceName,
  getRootResourceGroupName,
  getTerminalPipelineAppName,
  getTerminalStorageAccountName,
  getPrivateInstallerAppName,
  getWebStorageAccountName,
  getTerminalWebPubSubName,
  getFederatedCredential,
} from "../../logic/naming";
import { PRIVATE_INSTALLER_DELEGATED, REMOTE_TERMINAL_PROVIDERS, STORAGE_SCOPES } from "../../config/azureConfig";
import { enableStaticWebsite } from "../../api/azureBlob";
import { ensureScopeConsent } from "../../auth/msal";
import { createResultStorage } from "../../logic/resultStorage";
import { VALID_ENVS } from "../../config/githubConfig";
import type { Account, AzureConfigHook, AzureTarget, CardHook, CardStatus, SetupStep } from "../../types";

export type RemoteTerminalInfraResult = {
  corpName: string;
  subscriptionId: string;
  apiUrl: string;
  webPubSubHost: string;
  hubName: string;
  pipelineClientId: string;
  pipelineTenantId: string;
  installerClientId: string;
  appInsightsConnectionString: string;
};

export interface UseRemoteTerminalInfraCardParams extends AzureTarget {
  corpName: string;
  // Origins the browser calls /register and /negotiate from; without them every session fails on CORS.
  allowedOrigins: string[];
  githubAccount: Account | null;
  githubRepo: string;
  // GitHub's numeric repo id — needed for the immutable OIDC subject.
  githubRepoId: number | null;
}

export interface UseRemoteTerminalInfraCard extends CardHook, AzureConfigHook {
  readonly cardId: "remote_terminal_infra";
  location: string;
  setLocation: (loc: string) => void;
  resourceGroupName: string;
  webPubSubName: string;
  functionAppName: string;
  storageAccountName: string;
  webStorageAccountName: string;
  lawName: string;
  appInsightsName: string;
  hubName: string;
  pipelineAppName: string;
  result: RemoteTerminalInfraResult | null;
  resultMatches: boolean;
  runNonce: number;
}

const RESULT_KEY = "zeninstaller_remote_terminal_infra_result";
const { save: saveResult, load: loadResult } = createResultStorage<RemoteTerminalInfraResult>(RESULT_KEY);

/*
 * The relay the stage-card terminal runs on: Web PubSub, the session table, and the Function App
 * that issues group-scoped tokens. Mirrors web/deploy-remote-terminal/env, built from the browser
 * instead of Terraform. Every connection is managed identity — nothing here stores a key.
 */
export function useRemoteTerminalInfraCard({
  azureAccount,
  subscriptionId,
  corpName,
  tenantId,
  allowedOrigins,
  githubAccount,
  githubRepo,
  githubRepoId,
}: UseRemoteTerminalInfraCardParams): UseRemoteTerminalInfraCard {
  const [location, setLocation] = useState(DEFAULT_AZURE_LOCATION);
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const { ensureRegistered } = useProviderRegistration({ azureAccount, subscriptionId, tenantId });
  const [result, setResult] = useState<RemoteTerminalInfraResult | null>(loadResult);
  const [runNonce, setRunNonce] = useState(0);

  const resourceGroupName = getRootResourceGroupName(corpName);
  const lawName = getTerminalLogAnalyticsWorkspaceName(corpName);
  const appInsightsName = getTerminalAppInsightsName(corpName);
  const storageAccountName = getTerminalStorageAccountName(corpName);
  const webStorageAccountName = getWebStorageAccountName(corpName);
  const webPubSubName = getTerminalWebPubSubName(corpName);
  const functionAppName = getTerminalFunctionAppName(corpName);
  const planName = `${functionAppName}-plan`;
  const pipelineAppName = getTerminalPipelineAppName(corpName);
  const environments = ["PROD", "TEST"].filter((e) => VALID_ENVS.includes(e));

  const resultMatches = !!result && result.corpName === corpName && result.subscriptionId === subscriptionId;
  const done = resultMatches;
  const azureConfigured = !!azureAccount && !!subscriptionId && !!corpName;

  const reset = useCallback(() => {
    resetSteps();
    setResult(null);
    saveResult(null);
  }, [resetSteps]);

  const run = useCallback(async () => {
    if (!azureAccount || !subscriptionId || !corpName) return;
    if (!githubAccount || !githubRepo || githubRepoId === null) {
      setSteps([
        {
          id: "github",
          label: "Check the GitHub repository",
          status: "error",
          detail: "Select the GitHub account and repository first — the OIDC credentials are scoped to them",
        },
      ]);
      return;
    }
    const org = githubAccount.login;
    if (storageAccountName.length > 24) {
      setSteps([
        {
          id: "name",
          label: "Check resource names",
          status: "error",
          detail: `Storage account name "${storageAccountName}" is ${storageAccountName.length} characters; Azure allows 24`,
        },
      ]);
      return;
    }

    setRunning(true);
    const initialSteps: SetupStep[] = [
      { id: "providers", label: "Register required Azure resource providers", status: "pending" },
      { id: "rg", label: `Create resource group ${resourceGroupName}`, status: "pending" },
      { id: "law", label: `Create Log Analytics workspace ${lawName}`, status: "pending" },
      { id: "appins", label: `Create Application Insights ${appInsightsName}`, status: "pending" },
      { id: "storage", label: `Create storage account ${storageAccountName}`, status: "pending" },
      { id: "table", label: `Create ${TERMINAL_SESSION_TABLE} table`, status: "pending" },
      { id: "container", label: `Create ${TERMINAL_DEPLOY_CONTAINER} container`, status: "pending" },
      { id: "webStorage", label: `Create storage account ${webStorageAccountName}`, status: "pending" },
      { id: "webCors", label: "Allow this page to reach the blob service", status: "pending" },
      { id: "webConsent", label: "Consent to the storage data plane", status: "pending" },
      { id: "webStatic", label: "Enable static website hosting", status: "pending" },
      { id: "webRbac", label: "Grant yourself Storage Blob Data Contributor on it", status: "pending" },
      { id: "installerApp", label: `Create app registration ${getPrivateInstallerAppName()}`, status: "pending" },
      {
        id: "installerSp",
        label: `List ${getPrivateInstallerAppName()} under enterprise applications`,
        status: "pending",
      },
      { id: "wps", label: `Create Web PubSub ${webPubSubName}`, status: "pending" },
      { id: "hub", label: `Configure hub ${TERMINAL_HUB}`, status: "pending" },
      { id: "plan", label: "Create Flex Consumption plan", status: "pending" },
      { id: "app", label: `Create Function App ${functionAppName}`, status: "pending" },
      { id: "rbac", label: "Grant the Function App its data-plane roles", status: "pending" },
      { id: "pipelineApp", label: `Create app registration ${pipelineAppName}`, status: "pending" },
      { id: "pipelineSp", label: `List ${pipelineAppName} under enterprise applications`, status: "pending" },
      { id: "pipelineCreds", label: `Add GitHub OIDC credentials for ${environments.join(", ")}`, status: "pending" },
      { id: "pipelineRbac", label: "Grant it Web PubSub Service Owner", status: "pending" },
    ];
    setSteps(initialSteps);

    const mark = (id: string, r: "created" | "exists") =>
      updateStep(id, r === "exists" ? "skipped" : "done", r === "exists" ? "Already exists" : undefined);

    try {
      updateStep("providers", "running");
      const providers = await ensureRegistered(REMOTE_TERMINAL_PROVIDERS);
      updateStep(
        "providers",
        providers.registered.length === 0 ? "skipped" : "done",
        providers.registered.length === 0 ? "Already registered" : providers.registered.join(", "),
      );

      updateStep("rg", "running");
      mark("rg", await ensureResourceGroup(azureAccount, subscriptionId, resourceGroupName, location, tenantId));

      updateStep("law", "running");
      const law = await ensureLogAnalyticsWorkspace(
        azureAccount,
        subscriptionId,
        resourceGroupName,
        lawName,
        location,
        tenantId,
      );
      mark("law", law.result);

      updateStep("appins", "running");
      mark(
        "appins",
        // App Insights wants the workspace's resource id, not its name.
        await ensureAppInsights(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          appInsightsName,
          location,
          law.id,
          tenantId,
        ),
      );

      updateStep("storage", "running");
      mark(
        "storage",
        await ensureStorageAccount(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          storageAccountName,
          location,
          tenantId,
        ),
      );

      updateStep("table", "running");
      mark(
        "table",
        await ensureStorageTable(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          storageAccountName,
          TERMINAL_SESSION_TABLE,
          tenantId,
        ),
      );

      updateStep("container", "running");
      mark(
        "container",
        await ensureStorageContainer(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          storageAccountName,
          TERMINAL_DEPLOY_CONTAINER,
          tenantId,
        ),
      );

      updateStep("webStorage", "running");
      mark(
        "webStorage",
        await ensureStorageAccount(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          webStorageAccountName,
          location,
          tenantId,
        ),
      );

      updateStep("webCors", "running");
      await ensureBlobCors(
        azureAccount,
        subscriptionId,
        resourceGroupName,
        webStorageAccountName,
        allowedOrigins,
        tenantId,
      );
      updateStep("webCors", "done", allowedOrigins.join(", "));

      // Navigates away when consent is missing, so nothing below runs until the user comes back.
      updateStep("webConsent", "running");
      const promptedStorage = await ensureScopeConsent(azureAccount, [...STORAGE_SCOPES], tenantId);
      if (promptedStorage) return;
      updateStep("webConsent", "skipped", "Already granted");

      updateStep("webStatic", "running");
      await enableStaticWebsite(azureAccount, webStorageAccountName, tenantId);
      updateStep("webStatic", "done");

      // Owner does not reach the blob data plane, so the browser needs this to upload the built site.
      updateStep("webRbac", "running");
      mark(
        "webRbac",
        await ensureRbacRoleAtScope(
          azureAccount,
          storageAccountScope(subscriptionId, resourceGroupName, webStorageAccountName),
          azureAccount.localAccountId,
          "Storage Blob Data Contributor",
          tenantId,
          "User",
        ),
      );

      // The redirect uri is the site this card just created, so the app is registered after it.
      updateStep("installerApp", "running");
      const siteUrl = await getStaticWebsiteUrl(
        azureAccount,
        subscriptionId,
        resourceGroupName,
        webStorageAccountName,
        tenantId,
      );
      if (!siteUrl) throw new Error("The site's web endpoint is not available yet");
      const existingInstaller = await getExistingApp(azureAccount, getPrivateInstallerAppName(), tenantId);
      const installerApp =
        existingInstaller ??
        (await createSpaAppRegistration(
          azureAccount,
          getPrivateInstallerAppName(),
          [siteUrl],
          PRIVATE_INSTALLER_DELEGATED,
          tenantId,
        ));
      mark("installerApp", existingInstaller ? "exists" : "created");

      // Without a service principal the app has no enterprise application entry, so there is nothing
      // for an administrator to consent to and nothing to hold a permission grant.
      updateStep("installerSp", "running");
      const existingInstallerSp = await getExistingSP(azureAccount, installerApp.appId, tenantId);
      if (!existingInstallerSp) await createServicePrincipal(azureAccount, installerApp.appId, tenantId);
      mark("installerSp", existingInstallerSp ? "exists" : "created");

      updateStep("wps", "running");
      mark(
        "wps",
        await ensureWebPubSub(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          webPubSubName,
          location,
          "Free_F1",
          tenantId,
        ),
      );

      updateStep("hub", "running");
      mark(
        "hub",
        await ensureWebPubSubHub(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          webPubSubName,
          TERMINAL_HUB,
          tenantId,
        ),
      );

      updateStep("plan", "running");
      mark(
        "plan",
        await ensureFlexServicePlan(azureAccount, subscriptionId, resourceGroupName, planName, location, tenantId),
      );

      updateStep("app", "running");
      const blobBase = `https://${storageAccountName}.blob.core.windows.net`;
      const tableBase = `https://${storageAccountName}.table.core.windows.net`;
      const { result: appResult, principalId } = await ensureFlexFunctionApp(
        azureAccount,
        subscriptionId,
        resourceGroupName,
        functionAppName,
        location,
        servicePlanId(subscriptionId, resourceGroupName, planName),
        `${blobBase}/${TERMINAL_DEPLOY_CONTAINER}`,
        {
          APPLICATIONINSIGHTS_AUTHENTICATION_STRING: "Authorization=AAD",
          AzureWebJobsStorage__accountName: storageAccountName,
          AzureWebJobsStorage__credential: "managedidentity",
          AzureWebJobsStorage__blobServiceUri: `${blobBase}/`,
          AzureWebJobsStorage__tableServiceUri: `${tableBase}/`,
          AzureWebJobsStorage__queueServiceUri: `https://${storageAccountName}.queue.core.windows.net/`,
          // The platform's cors block is separate; the backend reads this one itself.
          ALLOWED_ORIGINS: allowedOrigins.join(","),
          WEBPUBSUB_ENDPOINT: `${webPubSubName}.webpubsub.azure.com`,
          HUB_NAME: TERMINAL_HUB,
          SESSION_TABLE_ACCOUNT_NAME: storageAccountName,
          SESSION_TABLE_NAME: TERMINAL_SESSION_TABLE,
        },
        allowedOrigins,
        tenantId,
      );
      mark("app", appResult);

      updateStep("rbac", "running");
      const saScope = storageAccountScope(subscriptionId, resourceGroupName, storageAccountName);
      const wpsScope = webPubSubScope(subscriptionId, resourceGroupName, webPubSubName);
      const grants: [string, string][] = [
        [saScope, "Storage Blob Data Contributor"],
        [saScope, "Storage Queue Data Contributor"],
        [saScope, "Storage Table Data Contributor"],
        [wpsScope, "Web PubSub Service Owner"],
        [appInsightsScope(subscriptionId, resourceGroupName, appInsightsName), "Monitoring Metrics Publisher"],
      ];
      const assigned: string[] = [];
      for (const [scope, role] of grants) {
        if ((await ensureRbacRoleAtScope(azureAccount, scope, principalId, role, tenantId)) === "created") {
          assigned.push(role);
        }
      }
      updateStep(
        "rbac",
        assigned.length === 0 ? "skipped" : "done",
        assigned.length === 0 ? "Already assigned" : assigned.join(", "),
      );

      updateStep("pipelineApp", "running");
      const existingApp = await getExistingApp(azureAccount, pipelineAppName, tenantId);
      const app = existingApp ?? (await createAppRegistration(azureAccount, pipelineAppName, [], tenantId));
      mark("pipelineApp", existingApp ? "exists" : "created");

      updateStep("pipelineSp", "running");
      const existingSp = await getExistingSP(azureAccount, app.appId, tenantId);
      const sp = existingSp ?? (await createServicePrincipal(azureAccount, app.appId, tenantId));
      mark("pipelineSp", existingSp ? "exists" : "created");

      updateStep("pipelineCreds", "running");
      let addedCreds = 0;
      for (const env of environments) {
        const cred = getFederatedCredential(org, githubAccount.id, githubRepo, githubRepoId, env);
        if (await ensureFederatedCredential(azureAccount, app.id, cred.name, cred.subject, tenantId)) addedCreds += 1;
      }
      mark("pipelineCreds", addedCreds === 0 ? "exists" : "created");

      // Service Owner, not Service Reader: issuing a client token is a POST on the data plane.
      updateStep("pipelineRbac", "running");
      mark(
        "pipelineRbac",
        await ensureRbacRoleAtScope(azureAccount, wpsScope, sp.id, "Web PubSub Service Owner", tenantId),
      );

      const finished: RemoteTerminalInfraResult = {
        corpName,
        subscriptionId,
        apiUrl: `https://${functionAppName}.azurewebsites.net`,
        webPubSubHost: `${webPubSubName}.webpubsub.azure.com`,
        hubName: TERMINAL_HUB,
        pipelineClientId: app.appId,
        pipelineTenantId: tenantId || azureAccount.tenantId,
        installerClientId: installerApp.appId,
        appInsightsConnectionString: await getAppInsightsConnectionString(
          azureAccount,
          subscriptionId,
          resourceGroupName,
          appInsightsName,
          tenantId,
        ),
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
    appInsightsName,
    azureAccount,
    corpName,
    ensureRegistered,
    functionAppName,
    lawName,
    location,
    planName,
    resourceGroupName,
    setRunning,
    setSteps,
    environments,
    githubAccount,
    githubRepo,
    githubRepoId,
    pipelineAppName,
    storageAccountName,
    subscriptionId,
    tenantId,
    updateStep,
    webPubSubName,
  ]);

  const status: CardStatus = !azureConfigured ? "error" : done ? "complete" : "warning";
  const summary = !azureConfigured ? "Unavailable" : done ? "Terminal relay ready" : "Set up the terminal relay";

  return {
    cardId: "remote_terminal_infra" as const,
    location,
    setLocation,
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
    webPubSubName,
    functionAppName,
    storageAccountName,
    webStorageAccountName,
    lawName,
    appInsightsName,
    hubName: TERMINAL_HUB,
    pipelineAppName,
    cardRequirements: ["azure_login", "azure_subscription", "core_infra"],
    cardDependencyLabel: "Set up the private zeninstaller environment",
  };
}
