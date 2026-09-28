/*
 * Deep links into the providers' own consoles, for each card's "view" action.
 * Azure resource links follow the documented portal form: #@{tenant}/resource{resourceId}/overview.
 */

const AZURE_PORTAL = "https://portal.azure.com";

// Blade form documented for app registrations; the section segment picks the sub-page.
export function getAppRegistrationUrl(appId: string): string {
  return `${AZURE_PORTAL}/#blade/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/Overview/appId/${appId}`;
}

// Portal list pages — the fallback for a card whose resource does not exist yet.
export const AZURE_APP_REGISTRATIONS_URL = `${AZURE_PORTAL}/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`;
