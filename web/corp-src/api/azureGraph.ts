import { getToken } from "../auth/msal";
import { azFetch as gFetch, ARM, GRAPH } from "./azureFetch";
import {
  APP_SCOPES,
  ARM_SCOPES,
  DOMAIN_SCOPES,
  ORGANIZATION_SCOPES,
  GRANT_CONSENT_SCOPES,
  ACCESS_PASS_SCOPES,
  GROUPS_SCOPES,
  ROLE_MANAGEMENT_SCOPES,
} from "../config/azureConfig";
import { RBAC_ROLE_IDS } from "../config/azureConfig";
import { deterministicUuid } from "../logic/crypto";
import type { AzureAccount, AzureTenant } from "../types";

// ── Subscriptions ──────────────────────────────────────────────────────────────

export type Subscription = { id: string; displayName: string; tenantId: string };

/*
 * ARM's /subscriptions returns every subscription the signed-in identity can access —
 * including ones in OTHER tenants (via guest access or Lighthouse cross-tenant delegation)
 * — regardless of which tenant's authority the token was acquired against. Filter to the
 * tenant actually being targeted, so e.g. a guest account doesn't see subscriptions from
 * a different tenant mixed into this one's picker.
 */
export async function listSubscriptions(account: AzureAccount, overrideTenantId?: string): Promise<Subscription[]> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const data = await gFetch(token, ARM, "/subscriptions?api-version=2020-01-01");
  const targetTenantId = overrideTenantId || account.tenantId;
  return (data.value ?? [])
    .filter((s) => s.tenantId === targetTenantId && s.state === "Enabled")
    .map((s) => ({
      id: s.subscriptionId,
      displayName: s.displayName,
      tenantId: s.tenantId,
    }));
}

// ── Tenants ──────────────────────────────────────────────────────────────────────

/*
 * Lists tenants the signed-in identity can access. Needs an ARM token, so it throws
 * MSA_NEEDS_TENANT for personal accounts before a tenant is chosen — callers fall back to
 * the tenant IDs the account already exposes (AzureAccount.tenantProfiles).
 */
export async function listTenants(account: AzureAccount, overrideTenantId?: string): Promise<AzureTenant[]> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const data = await gFetch(token, ARM, "/tenants?api-version=2022-12-01");
  return (data.value ?? []).map((t: { tenantId: string; displayName?: string; defaultDomain?: string }) => ({
    tenantId: t.tenantId,
    displayName: t.displayName || t.defaultDomain || t.tenantId,
    defaultDomain: t.defaultDomain,
  }));
}

// ── App registration ───────────────────────────────────────────────────────────

export async function getExistingApp(
  account: AzureAccount,
  displayName: string,
  overrideTenantId?: string,
): Promise<{ appId: string; id: string } | null> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/applications?$filter=displayName eq '${displayName}'&$select=appId,id`);
  return data.value?.[0] ? { appId: data.value[0].appId, id: data.value[0].id } : null;
}

// Reverse lookup: resolve an app registration's display name from its client (app) id.
export async function getAppNameByAppId(
  account: AzureAccount,
  appId: string,
  overrideTenantId?: string,
): Promise<string | null> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/applications?$filter=appId eq '${appId}'&$select=displayName`);
  return data.value?.[0]?.displayName ?? null;
}

export async function createAppRegistration(
  account: AzureAccount,
  displayName: string,
  permissions: readonly string[],
  overrideTenantId?: string,
): Promise<{ appId: string; id: string }> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const body: {
    displayName: string;
    signInAudience: string;
    requiredResourceAccess?: Array<{
      resourceAppId: string;
      resourceAccess: Array<{ id: string; type: "Role" }>;
    }>;
  } = {
    displayName,
    signInAudience: "AzureADMyOrg",
  };

  if (permissions.length > 0) {
    body.requiredResourceAccess = [
      {
        resourceAppId: "00000003-0000-0000-c000-000000000000",
        resourceAccess: permissions.map((id) => ({ id, type: "Role" })),
      },
    ];
  }

  const data = await gFetch(token, GRAPH, "/applications", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { appId: data.appId, id: data.id };
}

/*
 * requiredResourceAccess identifies a permission by guid, and those differ per resource and per
 * cloud — so they are read off each resource's own service principal by name rather than hardcoded.
 */
async function delegatedScopeIds(token: string, resourceAppId: string, scopeNames: readonly string[]) {
  const data = await gFetch(
    token,
    GRAPH,
    `/servicePrincipals?$filter=appId eq '${resourceAppId}'&$select=oauth2PermissionScopes`,
  );
  const published: { id: string; value: string }[] = data.value?.[0]?.oauth2PermissionScopes ?? [];
  return scopeNames.map((wanted) => {
    const scope = published.find((p) => p.value === wanted);
    if (!scope) throw new Error(`${resourceAppId} publishes no delegated scope named "${wanted}"`);
    return { id: scope.id, type: "Scope" as const };
  });
}

// A browser app signing in users: delegated permissions only, and redirect URIs under "spa" so the
// authorization code flow with PKCE is allowed without a client secret.
export async function createSpaAppRegistration(
  account: AzureAccount,
  displayName: string,
  redirectUris: string[],
  delegated: Record<string, readonly string[]>,
  overrideTenantId?: string,
): Promise<{ appId: string; id: string }> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const requiredResourceAccess = await Promise.all(
    Object.entries(delegated).map(async ([resourceAppId, scopes]) => ({
      resourceAppId,
      resourceAccess: await delegatedScopeIds(token, resourceAppId, scopes),
    })),
  );

  const data = await gFetch(token, GRAPH, "/applications", {
    method: "POST",
    body: JSON.stringify({
      displayName,
      signInAudience: "AzureADandPersonalMicrosoftAccount",
      api: { requestedAccessTokenVersion: 2 },
      spa: { redirectUris },
      requiredResourceAccess,
    }),
  });
  return { appId: data.appId, id: data.id };
}

// ── Service principal ──────────────────────────────────────────────────────────

export async function getExistingSP(
  account: AzureAccount,
  appId: string,
  overrideTenantId?: string,
): Promise<{ id: string } | null> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/servicePrincipals?$filter=appId eq '${appId}'&$select=id`);
  return data.value?.[0] ? { id: data.value[0].id } : null;
}

export async function createServicePrincipal(
  account: AzureAccount,
  appId: string,
  overrideTenantId?: string,
): Promise<{ id: string }> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const res = await fetch(`${GRAPH}/servicePrincipals`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ appId }),
  });
  if (res.status === 409) {
    // SP already exists — fetch it
    const existing = await getExistingSP(account, appId, overrideTenantId);
    if (existing) return existing;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} /servicePrincipals: ${body}`);
  }
  const data = await res.json();
  return { id: data.id };
}

// ── Federated credentials ──────────────────────────────────────────────────────

// Resolves to whether a credential was created; false means one with this subject already existed.
export async function ensureFederatedCredential(
  account: AzureAccount,
  appObjectId: string,
  name: string,
  subject: string,
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const existing = await gFetch(token, GRAPH, `/applications/${appObjectId}/federatedIdentityCredentials`);
  if (existing?.value?.some((c: { subject: string }) => c.subject === subject)) return false;
  await gFetch(token, GRAPH, `/applications/${appObjectId}/federatedIdentityCredentials`, {
    method: "POST",
    body: JSON.stringify({
      name,
      issuer: "https://token.actions.githubusercontent.com",
      subject,
      audiences: ["api://AzureADTokenExchange"],
    }),
  });
  return true;
}

// ── RBAC roles (ARM) ──────────────────────────────────────────────────────────

// Whether the principal already holds `roleName` on the subscription (read-only check).
export async function hasRbacRole(
  account: AzureAccount,
  subscriptionId: string,
  principalId: string,
  roleName: string,
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const roleId = RBAC_ROLE_IDS[roleName];
  const existing = await gFetch(
    token,
    ARM,
    `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=assignedTo('${principalId}')`,
  );
  return !!existing?.value?.some((a: { properties: { roleDefinitionId: string } }) =>
    a.properties.roleDefinitionId.toLowerCase().endsWith(roleId.toLowerCase()),
  );
}

export async function ensureRbacRole(
  account: AzureAccount,
  subscriptionId: string,
  spObjectId: string,
  roleName: string,
  overrideTenantId?: string,
): Promise<void> {
  if (await hasRbacRole(account, subscriptionId, spObjectId, roleName, overrideTenantId)) return;

  const token = await getToken(account, ARM_SCOPES, overrideTenantId);
  const scope = `/subscriptions/${subscriptionId}`;
  const roleId = RBAC_ROLE_IDS[roleName];
  const assignmentName = await deterministicUuid(scope, roleId, spObjectId);
  await gFetch(
    token,
    ARM,
    `${scope}/providers/Microsoft.Authorization/roleAssignments/${assignmentName}?api-version=2022-04-01`,
    {
      method: "PUT",
      body: JSON.stringify({
        properties: {
          roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
          principalId: spObjectId,
          principalType: "ServicePrincipal",
        },
      }),
    },
  );
}

// ── Admin consent ──────────────────────────────────────────────────────────────

// The Graph application-permission ids already assigned to this service principal.
export async function listAppRoleAssignments(
  account: AzureAccount,
  spObjectId: string,
  overrideTenantId?: string,
): Promise<string[]> {
  const token = await getToken(account, GRANT_CONSENT_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/servicePrincipals/${spObjectId}/appRoleAssignments?$select=appRoleId`);
  return (data?.value ?? []).map((a: { appRoleId: string }) => a.appRoleId);
}

export async function grantAdminConsent(
  account: AzureAccount,
  spObjectId: string,
  permissions: readonly string[],
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, GRANT_CONSENT_SCOPES, overrideTenantId);

  const graphSP = await gFetch(
    token,
    GRAPH,
    "/servicePrincipals?$filter=appId eq '00000003-0000-0000-c000-000000000000'&$select=id",
  );
  const graphSpId = graphSP?.value?.[0]?.id;
  if (!graphSpId) throw new Error("Microsoft Graph service principal not found in tenant");

  for (const permId of permissions) {
    await gFetch(token, GRAPH, `/servicePrincipals/${spObjectId}/appRoleAssignments`, {
      method: "POST",
      body: JSON.stringify({ principalId: spObjectId, resourceId: graphSpId, appRoleId: permId }),
    }).catch((err: Error) => {
      if (!err.message.includes("already exists") && !err.message.includes("409")) throw err;
    });
  }
}

// ── Revoke delegated permission grants ────────────────────────────────────────

export async function revokeOAuth2Grants(
  account: AzureAccount,
  appClientId: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, APP_SCOPES, overrideTenantId);
  const spRes = await gFetch(token, GRAPH, `/servicePrincipals?$filter=appId eq '${appClientId}'&$select=id`);
  const spId: string | undefined = spRes?.value?.[0]?.id;
  if (!spId) return;
  const grantsRes = await gFetch(token, GRAPH, `/oauth2PermissionGrants?$filter=clientId eq '${spId}'`);
  const ids: string[] = (grantsRes?.value ?? []).map((g: { id: string }) => g.id);
  await Promise.all(
    ids.map((id) => gFetch(token, GRAPH, `/oauth2PermissionGrants/${id}`, { method: "DELETE" }).catch(() => {})),
  );
}

// ── Entra custom domains ──────────────────────────────────────────────────────
/*
 * All use DOMAIN_SCOPES (incremental consent) — first call may throw
 * interaction_required until the user consents to Domain.ReadWrite.All.
 */

export type EntraDomain = { id: string; isVerified: boolean; isDefault: boolean };
export type VerifiedDomain = { name: string; isDefault: boolean; isInitial: boolean };

export async function listVerifiedDomains(account: AzureAccount, overrideTenantId?: string): Promise<VerifiedDomain[]> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, "/domains?$select=id,isVerified,isDefault,isInitial");
  return (data?.value ?? [])
    .filter((d: { isVerified: boolean }) => d.isVerified)
    .map((d: { id: string; isDefault: boolean; isInitial: boolean }) => ({
      name: d.id,
      isDefault: d.isDefault,
      isInitial: d.isInitial,
    }));
}

export async function listVerifiedDomainsViaOrganization(
  account: AzureAccount,
  overrideTenantId?: string,
): Promise<VerifiedDomain[]> {
  const token = await getToken(account, ORGANIZATION_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, "/organization?$select=verifiedDomains");
  return data?.value?.[0]?.verifiedDomains ?? [];
}

export async function getEntraDomain(
  account: AzureAccount,
  domainName: string,
  overrideTenantId?: string,
): Promise<EntraDomain | null> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  try {
    const data = await gFetch(token, GRAPH, `/domains/${domainName}`);
    return { id: data.id, isVerified: !!data.isVerified, isDefault: !!data.isDefault };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("404")) return null;
    throw err;
  }
}

export async function createEntraDomain(
  account: AzureAccount,
  domainName: string,
  overrideTenantId?: string,
): Promise<EntraDomain> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, "/domains", { method: "POST", body: JSON.stringify({ id: domainName }) });
  return { id: data.id, isVerified: !!data.isVerified, isDefault: !!data.isDefault };
}

// Returns the TXT verification token (e.g. "MS=ms12345678") for an unverified domain.
export async function getDomainVerificationTxt(
  account: AzureAccount,
  domainName: string,
  overrideTenantId?: string,
): Promise<string | null> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/domains/${domainName}/verificationDnsRecords`);
  const txt = (data.value ?? []).find(
    (r: { recordType?: string; text?: string }) => r.recordType?.toLowerCase() === "txt",
  );
  return txt?.text ?? null;
}

// Triggers domain verification. Throws if the DNS record hasn't propagated yet.
export async function verifyEntraDomain(
  account: AzureAccount,
  domainName: string,
  overrideTenantId?: string,
): Promise<EntraDomain> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/domains/${domainName}/verify`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return { id: data.id, isVerified: !!data.isVerified, isDefault: !!data.isDefault };
}

// Makes the domain the tenant's primary (default) domain. Requires the domain to be verified.
export async function setPrimaryEntraDomain(
  account: AzureAccount,
  domainName: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, DOMAIN_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, `/domains/${domainName}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) });
}

// ── Access Pass ─────────────────────────────────────────────────────────────────

export type EntraUser = { id: string; displayName: string; userPrincipalName: string };

export type TemporaryAccessPass = {
  id: string;
  temporaryAccessPass: string;
  startDateTime?: string;
  lifetimeInMinutes?: number;
  isUsableOnce?: boolean;
};

export type GraphAuthMethod = {
  id: string;
  "@odata.type"?: string;
};

// List Entra users managed by the signed-in user (direct reports) — populates the Access Pass user picker.
export async function listUsersManagedBySignedInUser(
  account: AzureAccount,
  overrideTenantId?: string,
): Promise<EntraUser[]> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  const users = await gFetch(
    token,
    GRAPH,
    "/me/directReports/microsoft.graph.user?$select=id,displayName,userPrincipalName",
  );

  return (users.value ?? [])
    .map((u: { id: string; displayName?: string; userPrincipalName?: string; mail?: string }) => ({
      id: u.id,
      displayName: u.displayName ?? u.userPrincipalName ?? u.mail ?? u.id,
      userPrincipalName: u.userPrincipalName ?? u.mail ?? "",
    }))
    .sort((a: EntraUser, b: EntraUser) => a.displayName.localeCompare(b.displayName));
}

const TAP_POLICY_PATH = "/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass";

// Ensures the tenant's authentication methods policy allows Temporary Access Pass, enabling
// it (without touching includeTargets/excludeTargets/lifetime settings) if currently
// disabled. Returns true if it needed to be enabled, false if it already was.
export async function ensureTemporaryAccessPassEnabled(
  account: AzureAccount,
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, TAP_POLICY_PATH);
  if (data.state === "enabled") return false;
  await gFetch(token, GRAPH, TAP_POLICY_PATH, {
    method: "PATCH",
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration",
      state: "enabled",
    }),
  });
  return true;
}

export async function listUserAuthenticationMethods(
  account: AzureAccount,
  userId: string,
  overrideTenantId?: string,
): Promise<GraphAuthMethod[]> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  // Do not use @odata.type in $select; Graph rejects it in select/expand expressions.
  const data = await gFetch(token, GRAPH, `/users/${userId}/authentication/methods`);
  return (data?.value ?? []) as GraphAuthMethod[];
}

export async function deleteUserAuthenticationMethod(
  account: AzureAccount,
  deletePath: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, deletePath, { method: "DELETE" });
}

export async function resetUserPassword(
  account: AzureAccount,
  userId: string,
  newPassword: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await gFetch(token, GRAPH, `/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          passwordProfile: {
            password: newPassword,
            forceChangePasswordNextSignIn: false,
            forceChangePasswordNextSignInWithMfa: false,
          },
        }),
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const retryable =
        msg.includes("409") && (msg.includes("Directory_ConcurrencyViolation") || msg.includes("concurrent requests"));

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = 400 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Creates a Temporary Access Pass for a user (requires delegated UserAuthenticationMethod.ReadWrite.All).
export async function createTemporaryAccessPassForUser(
  account: AzureAccount,
  userId: string,
  overrideTenantId?: string,
): Promise<TemporaryAccessPass> {
  const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
  const maxAttempts = 4;
  let data: {
    id: string;
    temporaryAccessPass: string;
    startDateTime?: string;
    lifetimeInMinutes?: number;
    isUsableOnce?: boolean;
  } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      data = await gFetch(token, GRAPH, `/users/${userId}/authentication/temporaryAccessPassMethods`, {
        method: "POST",
        body: JSON.stringify({
          isUsableOnce: true,
          lifetimeInMinutes: 60,
        }),
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const retryable =
        msg.includes("409") && (msg.toLowerCase().includes("conflict") || msg.includes("concurrent requests"));

      if (!retryable || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = 400 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!data) {
    throw new Error("Failed to create Temporary Access Pass");
  }

  return {
    id: data.id,
    temporaryAccessPass: data.temporaryAccessPass,
    startDateTime: data.startDateTime,
    lifetimeInMinutes: data.lifetimeInMinutes,
    isUsableOnce: data.isUsableOnce,
  };
}

// Checks whether a previously-created Temporary Access Pass method still exists for a user.
export async function temporaryAccessPassMethodExists(
  account: AzureAccount,
  userId: string,
  methodId: string,
  overrideTenantId?: string,
): Promise<boolean> {
  try {
    const token = await getToken(account, ACCESS_PASS_SCOPES, overrideTenantId);
    await gFetch(token, GRAPH, `/users/${userId}/authentication/temporaryAccessPassMethods/${methodId}?$select=id`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("404")) return false;
    throw err;
  }
}

// ── Entra security groups ──────────────────────────────────────────────────────

export type EntraGroup = { id: string; displayName: string; description: string };

// list — client-side sorted (matches listUsersManagedBySignedInUser's own client-side sort,
// avoids $orderby's ConsistencyLevel:eventual header requirement on directory objects).
export async function listGroups(account: AzureAccount, overrideTenantId?: string): Promise<EntraGroup[]> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, "/groups?$select=id,displayName,description&$top=999");
  return (data.value ?? [])
    .map((g: { id: string; displayName?: string; description?: string }) => ({
      id: g.id,
      displayName: g.displayName ?? g.id,
      description: g.description ?? "",
    }))
    .sort((a: EntraGroup, b: EntraGroup) => a.displayName.localeCompare(b.displayName));
}

// The groups (only, not admin units/directory roles) this group is itself a member of —
// i.e. its PARENT groups. Powers "Member of" without listing every group's members.
export async function getGroupParents(
  account: AzureAccount,
  groupId: string,
  overrideTenantId?: string,
): Promise<EntraGroup[]> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  const data = await gFetch(
    token,
    GRAPH,
    `/groups/${groupId}/memberOf/microsoft.graph.group?$select=id,displayName,description`,
  );
  return (data.value ?? []).map((g: { id: string; displayName?: string; description?: string }) => ({
    id: g.id,
    displayName: g.displayName ?? g.id,
    description: g.description ?? "",
  }));
}

export async function updateGroup(
  account: AzureAccount,
  groupId: string,
  patch: { displayName?: string; description?: string },
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, `/groups/${groupId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// Removes a member (user or group) from a group — the inverse of addGroupMember.
export async function removeGroupMember(
  account: AzureAccount,
  groupId: string,
  memberObjectId: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, `/groups/${groupId}/members/${memberObjectId}/$ref`, { method: "DELETE" });
}

// Permanently deletes the group. Irreversible — callers must confirm with the user first.
export async function deleteGroup(account: AzureAccount, groupId: string, overrideTenantId?: string): Promise<void> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, `/groups/${groupId}`, { method: "DELETE" });
}

// Group display names aren't unique in Entra, so this — not a POST-and-catch-409 — is the
// only reliable way to avoid creating duplicate groups on a repeat sync.
export async function getGroupByName(
  account: AzureAccount,
  displayName: string,
  overrideTenantId?: string,
): Promise<EntraGroup | null> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  const data = await gFetch(
    token,
    GRAPH,
    `/groups?$filter=displayName eq '${displayName}'&$select=id,displayName,description`,
  );
  const g = data.value?.[0];
  return g ? { id: g.id, displayName: g.displayName, description: g.description ?? "" } : null;
}

export async function createGroup(
  account: AzureAccount,
  // isAssignableToRole cannot be changed later, so a group that may ever hold a directory role
  // has to be born with it. Setting it also requires the caller to be a privileged role admin.
  params: { displayName: string; description: string; mailNickname: string; isAssignableToRole?: boolean },
  overrideTenantId?: string,
): Promise<EntraGroup> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, "/groups", {
    method: "POST",
    body: JSON.stringify({
      displayName: params.displayName,
      description: params.description,
      mailNickname: params.mailNickname,
      mailEnabled: false,
      securityEnabled: true,
      ...(params.isAssignableToRole && { isAssignableToRole: true }),
    }),
  });
  return { id: data.id, displayName: data.displayName, description: data.description ?? params.description };
}

// Works for both a user-in-group and a group-in-group member (both are directoryObjects).
export async function addGroupMember(
  account: AzureAccount,
  groupId: string,
  memberObjectId: string,
  overrideTenantId?: string,
): Promise<void> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, `/groups/${groupId}/members/$ref`, {
    method: "POST",
    body: JSON.stringify({ "@odata.id": `${GRAPH}/directoryObjects/${memberObjectId}` }),
  });
}

// Uses the checkMemberGroups action (not a members/{id} GET, which Graph doesn't support for
// this navigation property) — the documented way to test membership without listing everyone.
export async function isGroupMember(
  account: AzureAccount,
  groupId: string,
  memberObjectId: string,
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, GROUPS_SCOPES, overrideTenantId);
  const data = await gFetch(token, GRAPH, `/directoryObjects/${memberObjectId}/checkMemberGroups`, {
    method: "POST",
    body: JSON.stringify({ groupIds: [groupId] }),
  });
  return !!(data?.value ?? []).includes(groupId);
}

// ── PIM for Entra roles ───────────────────────────────────────────────────────

/*
 * Eligible, not active: members of the group hold nothing until they activate the role, and the
 * activation expires. Reading it back is a plain filter; creating it goes through a request object.
 */
export async function hasRoleEligibility(
  account: AzureAccount,
  principalId: string,
  roleDefinitionId: string,
  overrideTenantId?: string,
): Promise<boolean> {
  const token = await getToken(account, ROLE_MANAGEMENT_SCOPES, overrideTenantId);
  const filter = `principalId eq '${principalId}' and roleDefinitionId eq '${roleDefinitionId}'`;
  const data = await gFetch(
    token,
    GRAPH,
    `/roleManagement/directory/roleEligibilitySchedules?$filter=${encodeURIComponent(filter)}`,
  );
  return (data?.value ?? []).length > 0;
}

export async function ensureRoleEligibility(
  account: AzureAccount,
  principalId: string,
  roleDefinitionId: string,
  justification: string,
  overrideTenantId?: string,
): Promise<"created" | "exists"> {
  if (await hasRoleEligibility(account, principalId, roleDefinitionId, overrideTenantId)) return "exists";

  const token = await getToken(account, ROLE_MANAGEMENT_SCOPES, overrideTenantId);
  await gFetch(token, GRAPH, "/roleManagement/directory/roleEligibilityScheduleRequests", {
    method: "POST",
    body: JSON.stringify({
      action: "adminAssign",
      justification,
      roleDefinitionId,
      principalId,
      directoryScopeId: "/",
      scheduleInfo: { startDateTime: new Date().toISOString(), expiration: { type: "noExpiration" } },
    }),
  });
  return "created";
}
