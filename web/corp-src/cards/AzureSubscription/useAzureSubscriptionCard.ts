/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from "react";
import { listSubscriptions, type Subscription } from "../../api/azureGraph";
import { AZURE_CLIENT_ID } from "../../config/azureConfig";
import { findIgnoreCase } from "../../logic/search";
import type { UrlRestoreField } from "../../hooks/useUrlStateManager";
import type { CardHook, CardRequirements, CardStatus, AzureAccount } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────
export type UseAzureSubscriptionCardParams = {
  azureAccount: AzureAccount | null;
  confirmedTenantId: string | null;
  manualTenantId: string;
  savedSubscriptionId: string; // AZURE_SUBSCRIPTION_ID as saved on the GitHub environment.
};

export interface UseAzureSubscriptionCard extends CardHook {
  readonly cardId: "azure_subscription";
  subscriptions: Subscription[];
  selectedSubscriptionId: string;
  setSelectedSubscriptionId: (id: string) => void;
  subsError: string | null;
  subscriptionDrift: boolean;
  subscriptionNoAccess: boolean;
  subscriptionLabel?: string; // Display name of the saved (persisted) subscription — also fed to useAzureAppRegistrationCard.
  // Narrowed from CardHook (optional there) — every card provides these.
  cardRequirements: CardRequirements;
  cardDependencyLabel: string; // Label for the dependency that this card provides to others (e.g. "Select a subscription")
  restore: {
    subscription: UrlRestoreField;
  };
}

// Maps a raw MSAL/AADSTS failure to user-facing text — never surface the raw trace/correlation-id blob.
function friendlySubsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("AADSTS90072")) {
    return "This account isn't a member of that tenant — sign in with a different account, or have an admin add it as a guest first.";
  }
  return "Couldn't load subscriptions for this tenant — check the tenant ID or your access, then try again.";
}

export function useAzureSubscriptionCard({
  azureAccount,
  confirmedTenantId,
  manualTenantId,
  savedSubscriptionId,
}: UseAzureSubscriptionCardParams): UseAzureSubscriptionCard {
  const pickedTenant = manualTenantId.trim();

  const [loaded, setLoaded] = useState<{ tenant: string; subs: Subscription[]; error: string | null } | null>(null);
  const [picked, setPicked] = useState<{ tenant: string; id: string } | null>(null);
  const [subscriptionsLoaded, setSubscriptionsLoaded] = useState(false);

  const forThisTenant = loaded?.tenant === pickedTenant;
  const subscriptions = forThisTenant ? loaded.subs : [];
  const subsError = forThisTenant ? loaded.error : null;
  const selectedSubscriptionId = picked?.tenant === pickedTenant ? picked.id : "";

  const setSelectedSubscriptionId = (id: string) => setPicked({ tenant: pickedTenant, id });

  // Reload whenever the account or the confirmed tenant changes — the list is per-tenant.
  useEffect(() => {
    setSubscriptionsLoaded(false);
    if (!azureAccount || !confirmedTenantId?.trim()) return;
    let cancelled = false;
    const tenant = confirmedTenantId;
    listSubscriptions(azureAccount, tenant || undefined)
      .then((subs) => {
        if (cancelled) return;
        setLoaded({ tenant, subs, error: subs.length === 0 ? "No subscriptions found for this account." : null });
        if (subs.length === 1) setPicked({ tenant, id: subs[0].id });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ tenant, subs: [], error: friendlySubsError(err) });
      })
      .finally(() => {
        if (!cancelled) setSubscriptionsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [azureAccount, confirmedTenantId]);

  // ── Restore ───────────────────────────────────────────────────────────────
  const restoreSubscription = useCallback(
    (value: string): boolean => {
      const match = subscriptions.find((s) => s.id === value) ?? findIgnoreCase(subscriptions, (s) => s.displayName, value);
      if (!match) return false;
      setSelectedSubscriptionId(match.id);
      return true;
    },
    [subscriptions]
  );

  const subscriptionConfirmed = !!savedSubscriptionId && savedSubscriptionId === selectedSubscriptionId && confirmedTenantId === pickedTenant;
  const subscriptionDrift = !!selectedSubscriptionId && !subscriptionConfirmed;
  const subscriptionNoAccess = !!pickedTenant && !!subsError && subscriptions.length === 0;
  const subscriptionLabel = subscriptions.find((s) => s.id === savedSubscriptionId)?.displayName ?? (savedSubscriptionId || undefined);

  const azureConfigured = !!AZURE_CLIENT_ID;
  // Assumes prerequisites are met — App locks this card (via cardRequirements) whenever they're not,
  // which overrides this status to "idle" regardless of what's computed here.
  const status: CardStatus = subscriptionConfirmed ? "complete" : subscriptionDrift || subscriptionNoAccess ? "warning" : "idle";
  const summary = !azureConfigured
    ? "Unavailable"
    : subscriptionConfirmed
      ? (subscriptionLabel ?? "Subscription selected")
      : subscriptionDrift
        ? "Unsaved change — save to apply"
        : subscriptionNoAccess
          ? "No subscriptions in this tenant"
          : "Select a subscription";

  return {
    cardId: "azure_subscription" as const,
    subscriptions,
    selectedSubscriptionId,
    setSelectedSubscriptionId,
    subsError,
    subscriptionDrift,
    subscriptionNoAccess,
    subscriptionLabel,
    status,
    summary,
    cardRequirements: ["azure_login", "repo"],
    cardDependencyLabel: subscriptionDrift ? "Unsaved Subscription change" : "Select a subscription",
    done: subscriptionConfirmed,
    restore: {
      subscription: { ready: subscriptionsLoaded, scope: confirmedTenantId ?? null, apply: restoreSubscription },
    },
  };
}
