import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { AZURE_CLIENT_ID } from "../config/azureConfig";
import type { AzureAccount } from "../types";

export const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad"; // Microsoft consumer tenant (MSA accounts)

let _msal: PublicClientApplication | null = null;
let _initialized = false;

export async function getMsal(): Promise<PublicClientApplication | null> {
  if (!AZURE_CLIENT_ID) return null;
  if (!_msal) {
    _msal = new PublicClientApplication({
      auth: {
        clientId: AZURE_CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "sessionStorage" },
    });
  }
  if (!_initialized) {
    await _msal.initialize();
    _initialized = true;
  }
  return _msal;
}

export async function ensureScopeConsent(
  account: AzureAccount,
  scopes: string[],
  overrideTenantId?: string,
): Promise<boolean> {
  const msal = await getMsal();
  if (!msal) return false;
  const tenant = overrideTenantId || account.tenantId;
  const authority = tenant !== MSA_TENANT ? `https://login.microsoftonline.com/${tenant}` : undefined;
  const request = {
    scopes,
    account,
    ...(authority ? { authority } : {}),
    loginHint: account.username,
  };

  try {
    await msal.acquireTokenSilent(request);
    return false;
  } catch (err) {
    //TODO: Interpret the error to identify what went wrong and better communicate it to the user.
    // https://learn.microsoft.com/en-us/javascript/api/@azure/msal-node/interactionrequiredautherror?view=msal-js-latest
    if (!(err instanceof InteractionRequiredAuthError)) throw err;
  }
  //TODO: Improve the handover from silent to interactive by writing a message to the UI, and showing a popup instead of replacing the window with a crypting message from EntraID.

  // Navigates away; nothing after this runs. The user re-runs the card on their way back.
  await msal.acquireTokenRedirect(request);
  return true;
}

// ── Tokens ────────────────────────────────────────────────────────────────────
export async function getToken(account: AzureAccount, scopes: string[], overrideTenantId?: string): Promise<string> {
  const msal = await getMsal();
  if (!msal) throw new Error("MSAL not configured");

  const isArm = scopes.some((s) => s.includes("management.azure.com"));
  if (isArm && account.tenantId === MSA_TENANT && !overrideTenantId) {
    throw new Error("MSA_NEEDS_TENANT");
  }

  const tenant = overrideTenantId ?? account.tenantId;
  const authority = tenant !== MSA_TENANT ? `https://login.microsoftonline.com/${tenant}` : undefined;

  const res = await msal.acquireTokenSilent({
    scopes,
    account,
    ...(authority ? { authority } : {}),
  });
  return res.accessToken;
}

let activeAccount: AzureAccount | null = null;
let activeTenantId: string | undefined;

// Called by whoever owns the selection, so this stays a mirror rather than a second source.
export function setActiveAzureIdentity(account: AzureAccount | null, tenantId?: string): void {
  activeAccount = account;
  // getToken's ?? treats "" as a real tenant, so an unloaded variable has to become undefined.
  activeTenantId = tenantId || undefined;
}

// Acquired per call rather than held: MSAL refreshes silently and callers are minutes apart.
export async function getMsToken(scopes: string[]): Promise<string | null> {
  if (!activeAccount) return null;
  return getToken(activeAccount, scopes, activeTenantId);
}

export async function requireMsToken(scopes: string[]): Promise<string> {
  const token = await getMsToken(scopes);
  if (!token) throw new Error("Sign in with Microsoft first");
  return token;
}