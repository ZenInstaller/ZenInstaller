import { useCallback, useEffect, useRef } from "react";
import type { CardHook, CardRequirements, CardStatus, LoginHook, AzureAccount } from "../../types";
import { AZURE_CLIENT_ID } from "../../config/azureConfig";
import type { AzureTenant } from "../../types";
import { tenantDisplayName } from "../../logic/tenant";
import { findIgnoreCase } from "../../logic/search";
import { INITIAL_URL_PARAMS, type UrlRestoreField } from "../../hooks/useUrlStateManager";
import { useAzureAccount, type UseAzureAccount } from "./useAzureAccount";
import { setActiveAzureIdentity } from "../../auth/msal";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseAzureLoginCardParams = {
  savedTenantId: string; // AZURE_TENANT_ID as saved on the GitHub environment — auto-applied once known.
};

export interface UseAzureLoginCard extends UseAzureAccount, CardHook, LoginHook<AzureAccount> {
  readonly cardId: "azure_login";
  cardRequirements: CardRequirements;
  cardDependencyLabel: string; // Label for the dependency that this card provides to others (e.g. "Sign in to Azure")
  summary: string;

  login: () => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  tenants: AzureTenant[];
  manualTenantId: string;
  setManualTenantId: (id: string) => void;
  confirmedTenantId: string | null;
  selectTenant: (tenantId: string) => void;
  tenantIdError: string | null;
  savedTenantId: string;
  restore: {
    tenant: UrlRestoreField;
  };
}

/*
 * The Azure sign-in card — signing in AND picking the tenant, together, since nothing
 * downstream can run without both. The session/tenant state itself lives in
 * useAzureAccount (shared with the subscription and app-registration cards); this
 * projects it onto a card entry, gating everything else behind "signed in + tenant
 * confirmed", and owns the saved-tenant auto-prefill.
 */
export function useAzureLoginCard({ savedTenantId }: UseAzureLoginCardParams): UseAzureLoginCard {
  const azure = useAzureAccount();

  // The API layer mints its own Microsoft tokens, so it needs to know who it is minting them for.
  useEffect(() => {
    setActiveAzureIdentity(azure.account, savedTenantId);
  }, [azure.account, savedTenantId]);
  // Which saved tenant value we've already tried to auto-apply, so a fresh save can retrigger it once.
  const appliedSavedTenantRef = useRef<string | null>(null);
  useEffect(() => {
    if (!savedTenantId || appliedSavedTenantRef.current === savedTenantId) return;
    if (INITIAL_URL_PARAMS.has("tenant")) return; // Don't clobber a pending URL tenant restore.
    if (!azure.account || !azure.account.tenantProfiles?.has(savedTenantId)) return; // Can't apply a tenant without an account.
    appliedSavedTenantRef.current = savedTenantId;
    azure.selectTenant(savedTenantId);
    // azure itself is a fresh object every render — only its (useCallback-memoized) selectTenant matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTenantId, azure.selectTenant]);

  // ── Restore ───────────────────────────────────────────────────────────────
  const restoreTenant = useCallback(
    (value: string): boolean => {
      const match =
        azure.tenants.find((t) => t.tenantId.toLowerCase() === value.toLowerCase()) ??
        findIgnoreCase(azure.tenants, (t) => t.displayName, value);
      if (!match) return false;
      azure.selectTenant(match.tenantId);
      return true;
    },
    // azure itself is a fresh object every render — only tenants/selectTenant matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [azure.tenants, azure.selectTenant],
  );

  const done = !!azure.account && azure.confirmedTenantId !== null && !!azure.manualTenantId;
  const azureConfigured = !!AZURE_CLIENT_ID;
  const status: CardStatus = !azureConfigured
    ? "unavailable"
    : azure.account && done
      ? "complete"
      : azure.account
        ? "warning"
        : "idle";
  const summary = !azureConfigured
    ? "Unavailable"
    : !azure.account
      ? "Sign in to Azure"
      : done
        ? [azure.account.username, tenantDisplayName(azure.tenants, azure.confirmedTenantId)]
          .filter(Boolean)
          .join(" · ") || "Signed in"
        : "Select a tenant";

  return {
    ...azure,
    // cardHook
    cardId: "azure_login" as const,
    status,
    summary,
    cardRequirements: [],
    cardDependencyLabel: azure.account ? "Select a tenant" : "Sign in to Azure",
    done,

    savedTenantId,
    restore: {
      tenant: { ready: azure.tenantsLoaded, scope: azure.account?.homeAccountId ?? null, apply: restoreTenant },
    },
  };
}
