import { useEffect, useState } from "react";
import { getExistingSP, hasRbacRole } from "../../api/azureGraph";
import type { AzureSpTarget } from "../../types";

export type RbacCheckStatus = "unknown" | "sp-not-found" | "missing-role" | "ready";
export type RbacCheckResult = { status: RbacCheckStatus; missingRoles: string[] };

const IDLE: RbacCheckResult = { status: "unknown", missingRoles: [] };

export type UseRbacCheckParams = AzureSpTarget;

export function useRbacCheck({
  azureAccount,
  spClientId,
  subscriptionId,
  tenantId,
}: UseRbacCheckParams): RbacCheckResult {
  const [result, setResult] = useState<RbacCheckResult>(IDLE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!azureAccount || !spClientId || !subscriptionId) {
        if (!cancelled) setResult(IDLE);
        return;
      }
      if (!cancelled) setResult(IDLE);
      try {
        const sp = await getExistingSP(azureAccount, spClientId, tenantId);
        if (cancelled) return;
        if (!sp) {
          setResult({ status: "sp-not-found", missingRoles: [] });
          return;
        }
        const reader = await hasRbacRole(azureAccount, subscriptionId, sp.id, "Reader", tenantId);
        const missingRoles = reader ? [] : ["Reader"];
        if (!cancelled) setResult({ status: missingRoles.length === 0 ? "ready" : "missing-role", missingRoles });
      } catch {
        // Consent/token errors (e.g. before ARM consent) — leave unknown rather than flag missing.
        if (!cancelled) setResult(IDLE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [azureAccount, spClientId, subscriptionId, tenantId]);

  return result;
}
