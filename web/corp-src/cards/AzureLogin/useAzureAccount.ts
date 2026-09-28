import { useCallback, useEffect, useMemo, useState } from "react";
import { getMsal, MSA_TENANT } from "../../auth/msal";
import { LOGIN_SCOPES, ARM_SCOPES } from "../../config/azureConfig";
import { listTenants } from "../../api/azureGraph";
import type { AzureTenant } from "../../types";
import { getToken } from "../../auth/msal";
import { createResultStorage } from "../../logic/resultStorage";
import type { AzureAccount, LoginHook } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAzureAccount extends LoginHook<AzureAccount> {
  login: () => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  tenants: AzureTenant[];
  manualTenantId: string;
  setManualTenantId: (id: string) => void;
  /*
   * The tenant we've actually confirmed ARM access to, as opposed to manualTenantId which is
   * the raw text field and changes on every keystroke. null until the first confirmation;
   * "" means confirmed against the account's home tenant with no explicit override. Cards that
   * hit ARM key off this so they fire once per real tenant change, not once per character.
   */
  confirmedTenantId: string | null;
  tenantIdError: string | null;
  selectTenant: (tenantId: string) => void;
  tenantsLoaded: boolean;
}

const SESSION_KEY = "zeninstaller_arm_tenant";
// Must stay in sync with useAzureAppRegistrationCard's RESULT_KEY — read here only to recover an MSA
// account's real AAD tenant on mount, which the app-registration card recorded last run.
const azureResult = createResultStorage<{ tenantId: string }>("zeninstaller_azure_result");

// Maps a raw MSAL/AADSTS failure to user-facing text — never surface the raw trace/correlation-id blob.
function friendlyTenantError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("AADSTS90072")) {
    return "This account isn't a member of that tenant — sign in with a different account, or have an admin add it as a guest first.";
  }
  return "Couldn't reach that tenant — check the tenant ID or your access, then try again.";
}

/*
 * The Azure sign-in session itself: which MSAL account is active, which tenant it's scoped
 * to, and the ARM consent dance needed before anything can be read from that tenant. Not a
 * card — useAzureLoginCard, useAzureSubscriptionCard and useAzureAppRegistrationCard all read from it.
 */
export function useAzureAccount(): UseAzureAccount {
  const [account, setAccount] = useState<AzureAccount | null>(null);
  const [tenants, setTenants] = useState<AzureTenant[]>([]);
  const [loggingIn, setLoggingIn] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [manualTenantId, setManualTenantId] = useState("");
  const [confirmedTenantId, setConfirmedTenantId] = useState<string | null>(null);
  const [tenantIdError, setTenantIdError] = useState<string | null>(null);
  const [tenantsLoaded, setTenantsLoaded] = useState(false);

  // Tenant IDs the signed-in account already exposes — the MSA fallback when ARM /tenants can't run.
  const availableTenants = useMemo(() => {
    if (!account?.tenantProfiles) return [];
    return Array.from(account.tenantProfiles.keys()).filter((id) => id !== MSA_TENANT);
  }, [account]);

  const applyTenantList = useCallback((list: AzureTenant[]) => {
    setTenants(list);
    setManualTenantId((current) => {
      if (!current) return current;
      const match =
        list.find((t) => t.tenantId.toLowerCase() === current.toLowerCase()) ??
        list.find((t) => t.displayName.toLowerCase() === current.toLowerCase());
      return match ? match.tenantId : current;
    });
  }, []);

  // Fetch the tenant list via ARM (display names); fall back to the account's known tenant IDs for MSA.
  const loadTenants = useCallback(
    async (acc: AzureAccount) => {
      try {
        try {
          const list = await listTenants(acc);
          if (list.length > 0) {
            applyTenantList(list);
            return;
          }
        } catch {
          /* MSA / consent — fall through to the tenantProfiles fallback */
        }
        if (acc.tenantProfiles) {
          const ids = Array.from(acc.tenantProfiles.keys()).filter((id) => id !== MSA_TENANT);
          applyTenantList(ids.map((id) => ({ tenantId: id, displayName: id })));
        }
      } finally {
        setTenantsLoaded(true);
      }
    },
    [applyTenantList],
  );

  // Load the tenant list once signed in.
  useEffect(() => {
    setTenantsLoaded(false);
    if (account) void loadTenants(account);
  }, [account, loadTenants]);

  // Auto-select the first tenant when the account is MSA and nothing is pre-filled.
  useEffect(() => {
    if (!account || account.tenantId !== MSA_TENANT) return;
    if (manualTenantId || availableTenants.length === 0) return;
    setManualTenantId(availableTenants[0]);
    setConfirmedTenantId(availableTenants[0]);
  }, [account, availableTenants]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: handle redirect callback OR restore existing session
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const msal = await getMsal();
        if (!msal || cancelled) return;
        const result = await msal.handleRedirectPromise();
        if (cancelled) return;

        const savedTenant = sessionStorage.getItem(SESSION_KEY) || undefined;

        // Probe for an ARM token so the pending-consent redirect fires here rather than
        // surfacing later as an unexplained failure in whichever card reads ARM first.
        const tryConfirmArm = async (acc: AzureAccount, tenant: string | undefined) => {
          try {
            await getToken(acc, ARM_SCOPES, tenant);
            if (tenant) sessionStorage.removeItem(SESSION_KEY);
            if (!cancelled) setConfirmedTenantId(tenant ?? "");
          } catch (err) {
            // ARM consent not yet granted — redirect for ARM
            const msg = err instanceof Error ? err.message : "";
            if ((msg.includes("AADSTS65001") || msg.includes("interaction_required")) && tenant) {
              await msal.acquireTokenRedirect({
                scopes: ARM_SCOPES,
                authority: `https://login.microsoftonline.com/${tenant}`,
              });
            }
          }
        };

        const msaTenant = (acc: AzureAccount) =>
          acc.tenantId === MSA_TENANT ? (azureResult.load()?.tenantId ?? undefined) : undefined;

        if (result?.account) {
          setAccount(result.account);
          const tenant = savedTenant ?? msaTenant(result.account);
          if (tenant) setManualTenantId(tenant);
          await tryConfirmArm(result.account, tenant);
        } else {
          const accounts = msal.getAllAccounts();
          if (accounts.length > 0) {
            const preferredTid = savedTenant ?? azureResult.load()?.tenantId;
            const acc =
              (preferredTid ? accounts.find((a) => a.tenantId === preferredTid) : undefined) ??
              accounts.find((a) => a.tenantId !== MSA_TENANT) ??
              accounts[0];
            setAccount(acc);
            const tenant = savedTenant ?? msaTenant(acc);
            if (tenant) setManualTenantId(tenant);
            await tryConfirmArm(acc, tenant);
          }
        }
      } catch (err) {
        console.error("MSAL init error:", err);
      } finally {
        if (!cancelled) setLoggingIn(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async () => {
    setLoginError(null);
    try {
      const msal = await getMsal();
      if (!msal) return;
      await msal.loginRedirect({
        scopes: LOGIN_SCOPES,
        authority: "https://login.microsoftonline.com/common",
        prompt: "select_account",
      });
    } catch (err) {
      console.error("loginRedirect failed:", err);
      setLoginError(err instanceof Error ? err.message : "Login failed");
    }
  }, []);

  const confirmTenantId = useCallback(
    async (tenantIdArg?: string) => {
      if (!account) return;
      const tid = (tenantIdArg ?? manualTenantId).trim();
      if (!tid) {
        setTenantIdError("Please enter your Tenant ID");
        return;
      }
      setTenantIdError(null);

      const msal = await getMsal();
      if (!msal) return;

      // Use tenant-specific account from cache if available (avoids re-consent on repeat visits)
      const accounts = msal.getAllAccounts();
      const tenantAccount = accounts.find((a) => a.tenantId === tid) ?? account;

      try {
        // Silent ARM acquire first (listTenants/listSubscriptions are ARM-only) — may create a new AAD tenant account in MSAL cache
        await msal.acquireTokenSilent({
          scopes: ARM_SCOPES,
          account: tenantAccount,
          authority: `https://login.microsoftonline.com/${tid}`,
        });
        // Re-query cache and keep the best account for this tenant
        const refreshed = msal.getAllAccounts();
        const bestAccount = refreshed.find((a) => a.tenantId === tid) ?? tenantAccount;
        if (bestAccount !== account) setAccount(bestAccount);
        setManualTenantId(tid);
        setConfirmedTenantId(tid);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        const needsConsent =
          msg.includes("AADSTS65001") || msg.includes("interaction_required") || msg.includes("MSA_NEEDS_TENANT");
        if (!needsConsent) {
          setTenantIdError(friendlyTenantError(err));
          return;
        }
      }

      // No cached token for this tenant → redirect for consent
      sessionStorage.setItem(SESSION_KEY, tid);
      try {
        await msal.loginRedirect({
          scopes: ARM_SCOPES,
          authority: `https://login.microsoftonline.com/${tid}`,
          prompt: "consent",
        });
      } catch (err) {
        sessionStorage.removeItem(SESSION_KEY);
        setTenantIdError(err instanceof Error ? err.message : "Failed to redirect");
      }
    },
    [account, manualTenantId],
  );

  // Pick a tenant from the dropdown → point at it and confirm ARM access.
  // useAzureSubscriptionCard watches manualTenantId and reloads its own list.
  const selectTenant = useCallback(
    (tid: string) => {
      if (!account?.tenantProfiles?.has(tid)) {
        (async () => {
          const msal = await getMsal();
          if (!msal) return;
          await msal.acquireTokenRedirect({
            account: account,
            scopes: ARM_SCOPES,
            authority: `https://login.microsoftonline.com/${tid}`,
          });
        })();
      }
      setManualTenantId(tid);
      setTenantIdError(null);
      void confirmTenantId(tid);
    },
    [confirmTenantId],
  );

  const clearSession = useCallback(async () => {
    const msal = await getMsal();
    if (msal) await msal.clearCache().catch(() => { });
    setAccount(null);
    setTenants([]);
    setManualTenantId("");
    setConfirmedTenantId(null);
    setTenantIdError(null);
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  return {
    // loginHook
    account,
    login,
    logout,
    refresh: () => { },
    loggingIn,

    loginError,
    tenants,
    manualTenantId,
    setManualTenantId,
    confirmedTenantId,
    tenantIdError,
    tenantsLoaded,
    selectTenant,
  };
}
