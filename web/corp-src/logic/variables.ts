export const AZURE_VARIABLE_KEYS = [
  "AZURE_CLIENT_ID",
  "AZURE_PLAN_CLIENT_ID",
  "AZURE_SUBSCRIPTION_ID",
  "AZURE_TENANT_ID",
] as const;
// Tenant + subscription — saved by the Azure subscription card.
export const AZURE_TARGET_KEYS = ["AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID"] as const;
// App-registration client ids — saved by the Azure app registration card.
export const AZURE_APP_KEYS = ["AZURE_CLIENT_ID", "AZURE_PLAN_CLIENT_ID"] as const;
// Relay connection details — saved by the deployment terminal card.
export const DEPLOYMENT_TERMINAL_KEYS = [
  "WEBPUBSUB_ENDPOINT",
  "WEBPUBSUB_CLIENT_ID",
  "WEBPUBSUB_TENANT_ID",
  "BACKEND_API",
] as const;
export const AWS_VARIABLE_KEYS = ["AWS_ROLE_ARN"] as const;
export const CORP_NAME_KEYS = ["NAME"] as const;
export const DNS_KEYS = ["DNS"] as const;
export const C01_KEYS = ["CONTACT_EMAILS"] as const;

export const AZURE_SECRET_KEYS = ["AZURE_CLIENT_SECRET"];
export const AWS_SECRET_KEYS = ["AWS_CLIENT_SECRET"];

const VARIABLE_DISPLAY_NAMES: Record<string, string> = {
  NAME: "COMPANY_SHORT_CODE",
  DNS: "DNS Domain",
};

// Returns the UI label for a variable key, falling back to the key itself
export function getVariableDisplayName(key: string): string {
  return VARIABLE_DISPLAY_NAMES[key] ?? key;
}
