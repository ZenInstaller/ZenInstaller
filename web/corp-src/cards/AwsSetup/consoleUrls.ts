/*
 * Deep links into the providers' own consoles, for each card's "view" action.
 * Azure resource links follow the documented portal form: #@{tenant}/resource{resourceId}/overview.
 */

// ── AWS ───────────────────────────────────────────────────────────────────────

export function getIamRoleUrl(roleName: string): string {
  return `https://console.aws.amazon.com/iam/home#/roles/details/${roleName}`;
}
