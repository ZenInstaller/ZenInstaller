// ── App registration client ID (ZenInstaller SPA) ─────────────────────────────

export const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;

// ── OAuth scopes ───────────────────────────────────────────────────────────────

// Requested at login — just enough to sign in and read the profile. Everything
// else is requested incrementally, by the card that actually needs it.
export const LOGIN_SCOPES = ["openid", "profile", "User.Read"];

// App-registration card: create/read the app + SP, manage federated credentials.
export const APP_SCOPES = [
  "https://graph.microsoft.com/Application.ReadWrite.All",
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
];

export const ARM_SCOPES = ["https://management.azure.com/user_impersonation"];
export const STORAGE_SCOPES = ["https://storage.azure.com/user_impersonation"];
export const DOMAIN_SCOPES = ["https://graph.microsoft.com/Domain.ReadWrite.All"];
export const ORGANIZATION_SCOPES = ["https://graph.microsoft.com/Organization.Read.All"];

// Domain card: granting DomainReadWriteAll to the pipeline's service principal.
export const GRANT_CONSENT_SCOPES = [
  "https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All",
  "https://graph.microsoft.com/Application.Read.All",
];

export const ACCESS_PASS_SCOPES = [
  "https://graph.microsoft.com/User.ReadWrite.All",
  "https://graph.microsoft.com/UserAuthenticationMethod.ReadWrite.All",
  "https://graph.microsoft.com/Policy.ReadWrite.AuthenticationMethod",
];

export const GROUPS_SCOPES = ["https://graph.microsoft.com/Group.ReadWrite.All"];
export const ROLE_MANAGEMENT_SCOPES = ["https://graph.microsoft.com/RoleManagement.ReadWrite.Directory"];

// ── Individual Graph application permissions ───────────────────────────────────

export const GRAPH_PERMISSIONS = {
  GroupReadWriteAll: "62a82d76-70ea-41e2-9197-370581804d09",
  GroupMemberReadWriteAll: "dbaae8cf-10b5-4b86-a4a1-f871c94c6695",
  UserReadWriteAll: "741f803b-c850-494e-b5df-cde7c675a1ca",
  ApplicationReadWriteAll: "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9",
  AppRoleAssignmentReadWriteAll: "06b708a9-e830-4db3-a914-8e69da51d44f",
  RoleManagementReadWriteDirectory: "9e3f62cf-ca93-4989-b6ce-bf83c28f9fe8",
  UserAuthenticationMethodReadWriteAll: "50483e42-d915-4231-9639-7fdb7fd190e5",
  PolicyReadWriteAuthenticationMethod: "29c18626-4985-4dcd-85c0-193eef327366",
  PrivilegedAccessReadWriteAzureADGroup: "2f6817f8-7b12-4f0f-bc18-eeaf60705a9e",
  PolicyReadWriteApplicationConfiguration: "be74164b-cff1-491c-8741-e671cb536e13",
  DomainReadWriteAll: "7e05723c-0bb0-42da-be95-ae9f08a6e53c",
} as const;

export type GraphPermissionKey = keyof typeof GRAPH_PERMISSIONS;

/*
 * The delegated permissions the private installer's own sign-in app declares, by resource. Mirrors
 * what the cards actually ask for at runtime; the ids behind these names are looked up at creation.
 */
export const PRIVATE_INSTALLER_DELEGATED: Record<string, readonly string[]> = {
  // Microsoft Graph
  "00000003-0000-0000-c000-000000000000": [
    "User.Read",
    "Application.ReadWrite.All",
    "AppRoleAssignment.ReadWrite.All",
    "Application.Read.All",
    "Domain.ReadWrite.All",
  ],
  // Azure Service Management
  "797f4846-ba00-4fd7-ba43-dac1f8f63013": ["user_impersonation"],
  // Azure Storage
  "e406a681-f3d4-42a8-90b6-c2b029497af1": ["user_impersonation"],
};

// ── Entra directory roles ─────────────────────────────────────────────────────
// Template ids, which is what PIM's roleDefinitionId takes for built-in roles.
export const DIRECTORY_ROLE_IDS = {
  "Global Administrator": "62e90394-69f5-4237-9190-012177145e10",
} as const;

// ── RBAC built-in role IDs ─────────────────────────────────────────────────────

export const RBAC_ROLE_IDS: Record<string, string> = {
  Reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  "Storage Blob Data Reader": "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
  // Contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  // "User Access Administrator": "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9",
  "Storage Blob Data Contributor": "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  "Storage Table Data Contributor": "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3",
  "Storage Queue Data Contributor": "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  "Monitoring Metrics Publisher": "3913510d-42f4-4e42-8a64-420c390055eb",
  "Web PubSub Service Owner": "12cf5a90-567b-43ae-8102-96cf46c7d9b4",
  // Owner: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
};

// ── Function App settings the installer writes ─────────────────────────────────
export const BACKEND_VERSION_KEYS = {
  version: "BACKEND_VERSION",
  sha: "BACKEND_SHA",
  builtAt: "BACKEND_BUILT_AT",
} as const;

// ── Resource provider namespaces ───────────────────────────────────────────────
export const CORE_INFRA_PROVIDERS = [
  "Microsoft.OperationalInsights",
  "Microsoft.Insights",
  "Microsoft.Storage",
] as const;
export const DNS_PROVIDERS = ["Microsoft.Network"] as const;
export const REMOTE_TERMINAL_PROVIDERS = [
  "Microsoft.OperationalInsights",
  "Microsoft.Insights",
  "Microsoft.Storage",
  "Microsoft.SignalRService",
  "Microsoft.Web",
] as const;
