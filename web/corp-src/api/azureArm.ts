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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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

export async function fetchDeployedBackend(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  overrideTenantId?: string,
): Promise<DeployedBackend | null> {
  const settings = await readFunctionAppSettings(account, subscriptionId, resourceGroup, name, overrideTenantId);
  const version = settings[BACKEND_VERSION_KEYS.version];
  if (!version) return null;

  const token = await getToken(account, ARM_SCOPES, overrideTenantId);

  // Kudu owns when it went live; the stamp only knows what was sent.
  let deployedAt: number | null = null;
  const latest = await fetch(`https://${name}.scm.azurewebsites.net/api/deployments/latest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (latest.ok) {
    const ms = Date.parse((await latest.json())?.end_time ?? "");
    if (!Number.isNaN(ms)) deployedAt = Math.floor(ms / 1000);
  }
  return {
    version,
    sha: settings[BACKEND_VERSION_KEYS.sha] ?? "",
    builtAt: Number(settings[BACKEND_VERSION_KEYS.builtAt]) || 0,
    deployedAt,
  };
}

export async function deployZipToFunctionApp(
  account: AzureAccount,
  appName: string,
  zip: Blob,
  overrideTenantId?: string,
  onProgress?: (phase: "uploading" | "deploying") => void,
): Promise<void> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const scm = `https://${appName}.scm.azurewebsites.net`;

  onProgress?.("uploading");
  const res = await fetch(`${scm}/api/publish?type=zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    body: zip,
  });
  if (!res.ok) {
    throw new Error(`Deploying the package failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  // One-deploy returns as soon as the package is accepted; the unpack happens afterwards.
  onProgress?.("deploying");
  const start = Date.now();
  for (; ;) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await fetch(`${scm}/api/deployments/latest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status.ok) {
      const data = await status.json();
      if (data?.complete === true) {
        // Kudu's status: 3 is failed, 4 is success.
        if (data.status === 3) throw new Error(`Deployment failed: ${data.status_text || data.progress || "unknown"}`);
        return;
      }
    }
    if (Date.now() - start > 600_000) throw new Error("Deployment did not finish within 10 minutes");
  }
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
async function pollProvisioning(
  fetchState: () => Promise<string | undefined>,
  resourceLabel: string,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now();
  for (; ;) {
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
  overrideTenantId?: string,
): Promise<ProviderRegistrationState> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const data = (await gFetch(
    token,
    ARM,
    `/subscriptions/${subscriptionId}/providers/${namespace}?api-version=${PROVIDER_API}`,
  )) as { registrationState?: string };
  return (data?.registrationState as ProviderRegistrationState) ?? "Unknown";
}

// Requests registration. Returns immediately — ARM completes it asynchronously.
export async function registerProvider(
  account: AzureAccount,
  subscriptionId: string,
  namespace: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  await gFetch(
    token,
    ARM,
    `/subscriptions/${subscriptionId}/providers/${namespace}/register?api-version=${PROVIDER_API}`,
    {
      method: "POST",
    },
  );
}

// ── Locations ───────────────────────────────────────────────────────────────────

export type AzureLocation = { name: string; displayName: string };

// Lists physical Azure regions available to the subscription (excludes logical/paired regions).
export async function listLocations(
  account: AzureAccount,
  subscriptionId: string,
  overrideTenantId?: string,
): Promise<AzureLocation[]> {
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
  overrideTenantId?: string,
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = resourceGroupPath(subscriptionId, name);
  if (await armGet(token, path)) return "exists";
  await gFetch(token, ARM, path, { method: "PUT", body: JSON.stringify({ location }) });
  return "created";
}

// Read-only existence check — used by live "is infra still operable" checks (no create-on-miss).
export async function resourceGroupExists(
  account: AzureAccount,
  subscriptionId: string,
  name: string,
  overrideTenantId?: string,
): Promise<boolean> {
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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

// ── Application Insights ───────────────────────────────────────────────────────

export async function ensureAppInsights(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  workspaceId: string,
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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

export async function ensureStorageAccount(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  name: string,
  location: string,
  overrideTenantId?: string,
): Promise<EnsureResult> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const path = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${name}?api-version=2023-01-01`;
  if (await armGet(token, path)) return "exists";

  const availability = await gFetch(
    token,
    ARM,
    `/subscriptions/${subscriptionId}/providers/Microsoft.Storage/checkNameAvailability?api-version=2023-01-01`,
    {
      method: "POST",
      body: JSON.stringify({ name, type: "Microsoft.Storage/storageAccounts" }),
    },
  );
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

export async function ensureStorageContainer(
  account: AzureAccount,
  subscriptionId: string,
  resourceGroup: string,
  storageAccountName: string,
  containerName: string,
  overrideTenantId?: string,
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
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const roleId = RBAC_ROLE_IDS[roleName];
  const existing = await gFetch(
    token,
    ARM,
    `${scope}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=assignedTo('${principalId}')`,
  );
  return !!existing?.value?.some((a: { properties: { roleDefinitionId: string } }) =>
    a.properties.roleDefinitionId.toLowerCase().endsWith(roleId.toLowerCase()),
  );
}

export async function ensureRbacRoleAtScope(
  account: AzureAccount,
  scope: string,
  principalId: string,
  roleName: string,
  overrideTenantId?: string,
  principalType: "ServicePrincipal" | "Group" | "User" = "ServicePrincipal",
): Promise<EnsureResult> {
  if (await hasRbacRoleAtScope(account, scope, principalId, roleName, overrideTenantId)) return "exists";

  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const roleId = RBAC_ROLE_IDS[roleName];
  const assignmentName = await deterministicUuid(scope, roleId, principalId);
  await gFetch(
    token,
    ARM,
    `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentName}?api-version=2022-04-01`,
    {
      method: "PUT",
      body: JSON.stringify({
        properties: {
          roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
          principalId,
          principalType,
        },
      }),
    },
  );
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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
  overrideTenantId?: string,
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
