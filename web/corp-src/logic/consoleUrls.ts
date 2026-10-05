/*
 * Deep links into the providers' own consoles, for each card's "view" action.
 * Azure resource links follow the documented portal form: #@{tenant}/resource{resourceId}/overview.
 */

const AZURE_PORTAL = "https://portal.azure.com";
const ENTRA = "https://entra.microsoft.com";

// The @tenant segment is optional; without it the portal uses whichever tenant the session is on.
export function getAzureResourceUrl(tenantId: string | undefined, resourceId: string): string {
  // resourceId already starts with "/", so the tenant segment carries the separator, not the literal.
  return `${AZURE_PORTAL}/#${tenantId ? `@${tenantId}/` : ""}resource${resourceId}/overview`;
}

export function getAzureSubscriptionUrl(tenantId: string | undefined, subscriptionId: string): string {
  return getAzureResourceUrl(tenantId, `/subscriptions/${subscriptionId}`);
}

// Blade form documented for app registrations; the section segment picks the sub-page.
export function getAppRegistrationUrl(appId: string): string {
  return `${AZURE_PORTAL}/#blade/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/Overview/appId/${appId}`;
}

// Portal list pages — the fallback for a card whose resource does not exist yet.
export const AZURE_SUBSCRIPTIONS_URL = `${AZURE_PORTAL}/#servicemenu/Microsoft_Azure_Resources/ResourceManager/subscriptions`;
export const AZURE_RESOURCE_GROUPS_URL = `${AZURE_PORTAL}/#servicemenu/Microsoft_Azure_Resources/ResourceManager/resourcegroups`;
export const AZURE_DNS_ZONES_URL = `${AZURE_PORTAL}/#view/HubsExtension/AssetMenuBlade/~/PublicDnsZones/assetName/NetworkFoundation/extensionName/Microsoft_Azure_Network`;
export const AZURE_APP_REGISTRATIONS_URL = `${AZURE_PORTAL}/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`;

export function getEntraOverviewUrl(): string {
  return `${ENTRA}/#view/Microsoft_AAD_IAM/TenantOverview.ReactView`;
}

export function getEntraUsersUrl(): string {
  return `${ENTRA}/#view/Microsoft_AAD_UsersAndTenants/UserManagementMenuBlade/~/AllUsers`;
}

export function getEntraGroupsUrl(): string {
  return `${ENTRA}/#view/Microsoft_AAD_IAM/GroupsManagementMenuBlade/~/AllGroups`;
}

// ── AWS ───────────────────────────────────────────────────────────────────────

export function getAwsConsoleUrl(): string {
  return "https://console.aws.amazon.com/console/home";
}

export function getIamRoleUrl(roleName: string): string {
  return `https://console.aws.amazon.com/iam/home#/roles/details/${roleName}`;
}
