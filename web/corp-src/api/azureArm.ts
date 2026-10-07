/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { getToken } from "../auth/msal";
import { azFetch as gFetch, ARM } from "./azureFetch";
import { ARM_SCOPES, BACKEND_VERSION_KEYS, RBAC_ROLE_IDS } from "../config/azureConfig";
import { deterministicUuid } from "../logic/crypto";
import type { AzureAccount } from "../types";

// ── Function App code deployment ──────────────────────────────────────────────

function appSettingsPath(subscriptionId: string, resourceGroup: string, name: string) {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${name}/config/appsettings`;
}

export async function readFunctionAppSettings(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  overrideTenantId?: string
): Promise<Record<string, string>> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `${appSettingsPath(subscriptionId, resourceGroup, name)}/list?api-version=${WEB_API}`;
  return (await gFetch(token, ARM, path, { method: "POST" }))?.properties ?? {};
}

export async function updateFunctionAppSettings(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  settings: Record<string, string>,
  overrideTenantId?: string
): Promise<void> {
  const current = await readFunctionAppSettings(account, subscriptionId, resourceGroup, name, overrideTenantId);
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  await gFetch(token, ARM, `${appSettingsPath(subscriptionId, resourceGroup, name)}?api-version=${WEB_API}`, {
    method: "PUT",
    body: JSON.stringify({ properties: { ...current, ...settings } }),
  });
}

export type DeployedBackend = {
  version: string;
  sha: string;
  builtAt: number;
  deployedAt: number | null;
};

const DEPLOY_TIMEOUT_MS = 600_000;
// Published through ARM, not the app's own scm host, which a site with public access denied never answers.
const ONEDEPLOY_API = "2026-03-15";

/*
 * The deployment history, which is where the verdict is read from. extensions/onedeploy also answers
 * but its 200 has no documented schema and nothing to read until a one-deploy has happened; this one
 * returns a defined Deployment: status 4 succeeded, 3 failed, end_time when it went live.
 */
async function latestDeployment(
  token: string,
  subscriptionId: string,
  resourceGroup: string,
  name: string
): Promise<{ status?: number; message?: string; end_time?: string } | null> {
  const res = await fetch(
    `${ARM}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${name}/deployments?api-version=${WEB_API}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;

  const text = await res.text();
  const markup = text.search(/<!DOCTYPE|<html/i);
  let items: { properties?: { status?: number; message?: string; end_time?: string } }[] = [];
  try {
    items = JSON.parse(markup === -1 ? text : text.slice(0, markup))?.value ?? [];
  } catch {
    return null;
  }
  return (
    items
      .map((d) => d.properties ?? {})
      .sort((a: { end_time?: string }, b: { end_time?: string }) => Date.parse(b.end_time ?? "") - Date.parse(a.end_time ?? "") || 0)[0] ?? null
  );
}

export async function fetchDeployedBackend(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  overrideTenantId?: string
): Promise<DeployedBackend | null> {
  const settings = await readFunctionAppSettings(account, subscriptionId, resourceGroup, name, overrideTenantId);
  const version = settings[BACKEND_VERSION_KEYS.version];
  if (!version) return null;

  const token = await getToken(account, ARM_SCOPES, overrideTenantId);

  let deployedAt: number | null = null;
  const ms = Date.parse((await latestDeployment(token, subscriptionId, resourceGroup, name))?.end_time ?? "");
  if (!Number.isNaN(ms)) deployedAt = Math.floor(ms / 1000);
  return {
    version,
    sha: settings[BACKEND_VERSION_KEYS.sha] ?? "",
    builtAt: Number(settings[BACKEND_VERSION_KEYS.builtAt]) || 0,
    deployedAt,
  };
}

export async function deployZipToFunctionApp(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  appName: string,
  zip: Blob,
  overrideTenantId?: string,
  onProgress?: (phase: "uploading" | "deploying") => void
): Promise<void> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const url = `${ARM}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${appName}/extensions/onedeploy?api-version=${ONEDEPLOY_API}`;

  onProgress?.("uploading");
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    body: zip,
  });
  if (!res.ok) {
    throw new Error(`Deploying the package failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  // One-deploy returns as soon as the package is accepted; the unpack happens afterwards.
  onProgress?.("deploying");
  const startedAt = Date.now();
  const deadline = startedAt + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const latest = await latestDeployment(token, subscriptionId, resourceGroup, appName);
    // Older entries are still listed, so only one that finished after the upload is this deployment.
    if (latest?.end_time && Date.parse(latest.end_time) >= startedAt) {
      if (latest.status === 3) throw new Error(`Deployment failed: ${latest.message || "unknown"}`);
      if (latest.status === 4) return;
    }
  }
  throw new Error(`Deployment did not finish within ${DEPLOY_TIMEOUT_MS / 60_000} minutes`);
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

type ArmResource = {
  id?: string;
  identity?: { principalId?: string };
  properties?: {
    provisioningState?: string;
    nameServers?: string[];
    TXTRecords?: { value: string[] }[];
  };
};

// GET that treats 404 as null instead of throwing.
async function armGet(token: string, path: string): Promise<ArmResource | null> {
  try {
    return await gFetch(token, ARM, path);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("404")) return null;
    throw err;
  }
}

// Polls fetchState until it returns "Succeeded". Throws on "Failed"/"Canceled" or timeout.
async function pollProvisioning(fetchState: () => Promise<string | undefined>, resourceLabel: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const state = await fetchState();
    if (state === "Succeeded") return;
    if (state === "Failed" || state === "Canceled") throw new Error(`${resourceLabel} provisioning ${state}`);
    if (Date.now() - start > timeoutMs) throw new Error(`${resourceLabel} provisioning timed out`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export type EnsureResult = "created" | "exists";

// ── Resource providers ─────────────────────────────────────────────────────────

const PROVIDER_API = "2021-04-01";

export type ProviderRegistrationState = "Registered" | "Registering" | "NotRegistered" | "Unregistered" | "Unknown";

// Current registration state of a resource provider namespace on the subscription.
export async function getProviderRegistrationState(
  account: AzureAccount,
  subscriptionId: string,
  namespace: string,
  overrideTenantId?: string
): Promise<ProviderRegistrationState> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const data = (await gFetch(token, ARM, `/subscriptions/${subscriptionId}/providers/${namespace}?api-version=${PROVIDER_API}`)) as {
    registrationState?: string;
  };
  return (data?.registrationState as ProviderRegistrationState) ?? "Unknown";
}

// Requests registration. Returns immediately — ARM completes it asynchronously.
export async function registerProvider(account: AzureAccount, subscriptionId: string, namespace: string, overrideTenantId?: string): Promise<void> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  await gFetch(token, ARM, `/subscriptions/${subscriptionId}/providers/${namespace}/register?api-version=${PROVIDER_API}`, {
    method: "POST",
  });
}

// ── Locations ───────────────────────────────────────────────────────────────────

export type AzureLocation = { name: string; displayName: string };

// Lists physical Azure regions available to the subscription (excludes logical/paired regions).
export async function listLocations(account: AzureAccount, subscriptionId: string, overrideTenantId?: string): Promise<AzureLocation[]> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const data = await gFetch(token, ARM, `/subscriptions/${subscriptionId}/locations?api-version=2022-12-01`);
  const raw: { name: string; displayName: string; metadata?: { regionType?: string } }[] = data?.value ?? [];
  return raw
    .filter((l) => l.metadata?.regionType === "Physical")
    .map((l) => ({ name: l.name, displayName: l.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── Resource group ─────────────────────────────────────────────────────────────

function resourceGroupPath(subscriptionId: string, name: string): string {
  return `/subscriptions/${subscriptionId}/resourcegroups/${name}?api-version=2021-04-01`;
}

export async function ensureResourceGroup(
  account: AzureAccount,
  subscriptionId: string,
  name: string,
  location: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = resourceGroupPath(subscriptionId, name);
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, { method: "PUT", body: JSON.stringify({ location }) });
  return "created";
}

// Read-only existence check — used by live "is infra still operable" checks (no create-on-miss).
export async function resourceGroupExists(account: AzureAccount, subscriptionId: string, name: string, overrideTenantId?: string): Promise<boolean> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  return !!(await armGet(token, resourceGroupPath(subscriptionId, name)));
}

// ── Log Analytics workspace ────────────────────────────────────────────────────

export async function ensureLogAnalyticsWorkspace(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  overrideTenantId?: string
): Promise<{ id: string; result: EnsureResult }> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${name}?api-version=2022-10-01`;
  const existing = await armGet(token, path);
  if (existing) return { id: existing.id ?? "", result: "exists" };
  const created = await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({ location, properties: { sku: { name: "PerGB2018" }, retentionInDays: 30 } }),
  });
  await pollProvisioning(async () => {
    const t = await getToken(account, ARM_SCOPES, overrideTenantId);
    return (await armGet(t, path))?.properties?.provisioningState;
  }, "Log Analytics workspace");
  return { id: created?.id ?? (await armGet(token, path))?.id ?? "", result: "created" };
}

// ── Subscription activity-log diagnostics ──────────────────────────────────────

export async function ensureSubscriptionDiagnostics(
  account: AzureAccount,
  subscriptionId: string,
  settingName: string,
  workspaceId: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Insights/diagnosticSettings/${settingName}?api-version=2021-05-01-preview`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({
      properties: {
        workspaceId,
        logs: [
          { category: "Administrative", enabled: true },
          { category: "Security", enabled: true },
        ],
      },
    }),
  });
  return "created";
}

export async function ensureBlobDiagnostics(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  storageAccountName: string,
  settingName: string,
  workspaceId: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}/blobServices/default/providers/Microsoft.Insights/diagnosticSettings/${settingName}?api-version=2021-05-01-preview`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({
      properties: {
        workspaceId,
        logs: [
          { category: "StorageWrite", enabled: true },
          { category: "StorageDelete", enabled: true },
        ],
      },
    }),
  });
  return "created";
}

// ── Application Insights ───────────────────────────────────────────────────────

// The browser needs the whole connection string, not just the key, and it is only on the resource.
export async function getAppInsightsConnectionString(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  overrideTenantId?: string
): Promise<string> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Insights/components/${name}?api-version=2020-02-02`;
  const component = await armGet(token, path);
  return (component?.properties as { ConnectionString?: string } | undefined)?.ConnectionString ?? "";
}

export async function ensureAppInsights(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  workspaceId: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Insights/components/${name}?api-version=2020-02-02`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({
      location,
      kind: "web",
      properties: { Application_Type: "web", WorkspaceResourceId: workspaceId },
    }),
  });
  return "created";
}

// ── DNS zone + TXT record ──────────────────────────────────────────────────────

export async function ensureDnsZone(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  dnsName: string,
  overrideTenantId?: string
): Promise<{ nameServers: string[]; result: EnsureResult }> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/dnsZones/${dnsName}?api-version=2018-05-01`;
  const existing = await armGet(token, path);
  if (existing) return { nameServers: existing.properties?.nameServers ?? [], result: "exists" };
  const created = await gFetch(token, ARM, path, { method: "PUT", body: JSON.stringify({ location: "global" }) });
  return { nameServers: created?.properties?.nameServers ?? [], result: "created" };
}

// Ensures the apex TXT record contains `value`. Merges with existing TXT values rather than overwriting.
export async function ensureDnsTxtRecord(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  dnsName: string,
  value: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/dnsZones/${dnsName}/TXT/@?api-version=2018-05-01`;
  const existing = await armGet(token, path);
  const records: { value: string[] }[] = existing?.properties?.TXTRecords ?? [];
  if (records.some((r) => r.value.includes(value))) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({ properties: { TTL: 3600, TXTRecords: [...records, { value: [value] }] } }),
  });
  return "created";
}

// ── Storage account + container ────────────────────────────────────────────────

type StorageAccountRow = { id?: string; name?: string; properties?: { primaryEndpoints?: { web?: string } } };

async function findStorageAccount(token: string, subscriptionId: string, name: string): Promise<StorageAccountRow | null> {
  const data = await armGet(token, `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`);
  return ((data as { value?: StorageAccountRow[] } | null)?.value ?? []).find((a) => a.name === name) ?? null;
}

// checkNameAvailability never says who holds a name; this is what tells "ours, elsewhere" apart.
// ponytail: subscription-scoped, widen to Resource Graph if accounts spread across subscriptions.
export async function findStorageAccountGroup(account: AzureAccount, subscriptionId: string, name: string, overrideTenantId?: string): Promise<string | null> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const found = await findStorageAccount(token, subscriptionId, name);
  return found?.id?.match(/resourceGroups\/([^/]+)/i)?.[1] ?? null;
}

// Azure answers for the whole world, so "unavailable" can also mean someone else's account.
export async function storageAccountNameAvailable(account: AzureAccount, subscriptionId: string, name: string, overrideTenantId?: string): Promise<boolean> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const availability = await gFetch(token, ARM, `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/checkNameAvailability?api-version=2023-01-01`, {
    method: "POST",
    body: JSON.stringify({ name, type: "Microsoft.Storage/storageAccounts" }),
  });
  return availability?.nameAvailable !== false;
}

export async function ensureStorageAccount(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${name}?api-version=2023-01-01`;
  if (await armGet(token, path)) return "exists";

  const availability = await gFetch(token, ARM, `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/checkNameAvailability?api-version=2023-01-01`, {
    method: "POST",
    body: JSON.stringify({ name, type: "Microsoft.Storage/storageAccounts" }),
  });
  if (availability?.nameAvailable === false) {
    throw new Error(`Storage account name "${name}" unavailable: ${availability.message ?? availability.reason}`);
  }

  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({ location, sku: { name: "Standard_LRS" }, kind: "StorageV2" }),
  });
  await pollProvisioning(async () => {
    const t = await getToken(account, ARM_SCOPES, overrideTenantId);
    return (await armGet(t, path))?.properties?.provisioningState;
  }, "Storage account");
  return "created";
}

export async function ensureBlobServiceProperties(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  allowedOrigins: string[],
  overrideTenantId?: string,
  indexDocument = "index.html"
): Promise<void> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${name}/blobServices/default?api-version=2025-08-01`;
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({
      properties: {
        // The PUT replaces what it is given, so both have to travel together or one wipes the other.
        staticWebsite: { enabled: true, indexDocument, errorDocument404Path: indexDocument },
        cors: {
          corsRules: [
            {
              allowedOrigins,
              allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT"],
              allowedHeaders: ["*"],
              exposedHeaders: ["*"],
              maxAgeInSeconds: 3600,
            },
          ],
        },
      },
    }),
  });
}

// The web endpoint's host is assigned by Azure, so it is read back rather than composed.
export async function getStaticWebsiteUrl(account: AzureAccount, subscriptionId: string, name: string, overrideTenantId?: string): Promise<string | null> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const web = (await findStorageAccount(token, subscriptionId, name))?.properties?.primaryEndpoints?.web;
  return web ? web.replace(/\/+$/, "") : null;
}

export async function ensureStorageContainer(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  storageAccountName: string,
  containerName: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}/blobServices/default/containers/${containerName}?api-version=2023-01-01`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, { method: "PUT", body: JSON.stringify({ properties: { publicAccess: "None" } }) });
  return "created";
}

// ── Scoped RBAC role assignment ────────────────────────────────────────────────
// Same as azureGraph's ensureRbacRole but at an arbitrary scope (e.g. a storage account)
export async function hasRbacRoleAtScope(
  account: AzureAccount,
  scope: string,
  principalId: string,
  roleName: string,
  overrideTenantId?: string
): Promise<boolean> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const roleId = RBAC_ROLE_IDS[roleName];
  const existing = await gFetch(
    token,
    ARM,
    `${scope}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=assignedTo('${principalId}')`
  );
  return !!existing?.value?.some((a: { properties: { roleDefinitionId: string } }) =>
    a.properties.roleDefinitionId.toLowerCase().endsWith(roleId.toLowerCase())
  );
}

export async function ensureRbacRoleAtScope(
  account: AzureAccount,
  scope: string,
  principalId: string,
  roleName: string,
  overrideTenantId?: string,
  principalType: "ServicePrincipal" | "Group" | "User" = "ServicePrincipal"
): Promise<EnsureResult> {
  if (await hasRbacRoleAtScope(account, scope, principalId, roleName, overrideTenantId)) return "exists";

  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const roleId = RBAC_ROLE_IDS[roleName];
  const assignmentName = await deterministicUuid(scope, roleId, principalId);
  await gFetch(token, ARM, `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentName}?api-version=2022-04-01`, {
    method: "PUT",
    body: JSON.stringify({
      properties: {
        roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
        principalId,
        principalType,
      },
    }),
  });
  return "created";
}

export function storageAccountScope(subscriptionId: string, resourceGroup: string, storageAccountName: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}`;
}

export function dnsZoneScope(subscriptionId: string, resourceGroup: string, dnsName: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/dnsZones/${dnsName}`;
}
export function resourceGroupScope(subscriptionId: string, resourceGroup: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
}

export function subscriptionScope(subscriptionId: string): string {
  return `/subscriptions/${subscriptionId}`;
}

// ── Remote terminal infrastructure ─────────────────────────────────────────────

const WEBPUBSUB_API = "2023-02-01";
const WEB_API = "2023-12-01";

export async function ensureWebPubSub(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  sku: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.SignalRService/webPubSub/${name}?api-version=${WEBPUBSUB_API}`;
  if (await armGet(token, path)) return "exists";

  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({ location, sku: { name: sku, capacity: 1 } }),
  });
  await pollProvisioning(async () => {
    const t = await getToken(account, ARM_SCOPES, overrideTenantId);
    return (await armGet(t, path))?.properties?.provisioningState;
  }, "Web PubSub");
  return "created";
}

// The hub settings record. Connections already require a token without it; this pins that shut so a
// portal change cannot quietly enable anonymous connect.
export async function ensureWebPubSubHub(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  webPubSubName: string,
  hubName: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.SignalRService/webPubSub/${webPubSubName}/hubs/${hubName}?api-version=${WEBPUBSUB_API}`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({ properties: { anonymousConnectPolicy: "deny" } }),
  });
  return "created";
}

export async function ensureStorageTable(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  storageAccountName: string,
  tableName: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName}/tableServices/default/tables/${tableName}?api-version=2023-01-01`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, { method: "PUT", body: JSON.stringify({}) });
  return "created";
}

export async function ensureFlexServicePlan(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  overrideTenantId?: string
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/serverfarms/${name}?api-version=${WEB_API}`;
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, {
    method: "PUT",
    body: JSON.stringify({
      location,
      kind: "functionapp",
      sku: { name: "FC1", tier: "FlexConsumption" },
      properties: { reserved: true },
    }),
  });
  return "created";
}

export type FunctionAppSettings = Record<string, string>;

// Flex Consumption, system-assigned identity, deployment container reached by that identity —
// the same shape web/deploy-remote-terminal/env/main.tf declares.
export async function ensureFlexFunctionApp(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  planId: string,
  deploymentContainerUrl: string,
  appSettings: FunctionAppSettings,
  allowedOrigins: string[],
  overrideTenantId?: string
): Promise<{ result: EnsureResult; principalId: string }> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${name}?api-version=${WEB_API}`;
  const existing = await armGet(token, path);

  if (!existing) {
    await gFetch(token, ARM, path, {
      method: "PUT",
      body: JSON.stringify({
        location,
        kind: "functionapp,linux",
        identity: { type: "SystemAssigned" },
        properties: {
          serverFarmId: planId,
          functionAppConfig: {
            deployment: {
              storage: {
                type: "blobContainer",
                value: deploymentContainerUrl,
                authentication: { type: "SystemAssignedIdentity" },
              },
            },
            runtime: { name: "node", version: "22" },
            scaleAndConcurrency: { maximumInstanceCount: 100, instanceMemoryMB: 2048 },
          },
          siteConfig: {
            appSettings: Object.entries(appSettings).map(([nameKey, value]) => ({ name: nameKey, value })),
            cors: { allowedOrigins },
          },
        },
      }),
    });
    await pollProvisioning(async () => {
      const t = await getToken(account, ARM_SCOPES, overrideTenantId);
      return (await armGet(t, path))?.properties?.provisioningState;
    }, "Function App");
  }

  const t = await getToken(account, ARM_SCOPES, overrideTenantId);
  const site = await armGet(t, path);
  const principalId = site?.identity?.principalId;
  if (!principalId) throw new Error(`Function App ${name} has no system-assigned identity`);
  return { result: existing ? "exists" : "created", principalId };
}

export function webPubSubScope(subscriptionId: string, resourceGroup: string, name: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.SignalRService/webPubSub/${name}`;
}

export function appInsightsScope(subscriptionId: string, resourceGroup: string, name: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Insights/components/${name}`;
}

export function servicePlanId(subscriptionId: string, resourceGroup: string, name: string): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/serverfarms/${name}`;
}
