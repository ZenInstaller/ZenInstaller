import { useCallback, useState } from "react";
import { getExistingSP, grantAdminConsent, listAppRoleAssignments } from "../../../api/azureGraph";
import type { AzureAccount } from "../../../types";

export type UseAzurePermissionsParams = {
  azureAccount: AzureAccount | null;
  spClientId: string; // The app registration's client id — its service principal is what the pipeline runs as.
  tenantId?: string;
  permissions?: readonly string[]; // Microsoft Graph application permission ids this caller needs.
};

export type UseAzurePermissions = {
  ensure: () => Promise<void>;
  granting: boolean;
};

// A stable default, so a caller that needs nothing does not hand `ensure` a fresh array each render.
const NONE: readonly string[] = [];

// Grants the Graph application permissions one caller needs, skipping any already assigned.
export function useAzurePermissions({
  azureAccount,
  spClientId,
  tenantId,
  permissions = NONE,
}: UseAzurePermissionsParams): UseAzurePermissions {
  const [granting, setGranting] = useState(false);

  // No-ops when Azure isn't wired up yet, so callers behave exactly as they did before.
  const ensure = useCallback(async () => {
    if (!azureAccount || !spClientId || permissions.length === 0) return;
    setGranting(true);
    try {
      const sp = await getExistingSP(azureAccount, spClientId, tenantId);
      if (!sp) throw new Error(`Service principal for app ${spClientId} not found — run the Azure card first`);

      const assigned = new Set(await listAppRoleAssignments(azureAccount, sp.id, tenantId));
      const missing = permissions.filter((id) => !assigned.has(id));
      if (missing.length > 0) await grantAdminConsent(azureAccount, sp.id, missing, tenantId);
    } finally {
      setGranting(false);
    }
  }, [azureAccount, spClientId, tenantId, permissions]);

  return { ensure, granting };
}
