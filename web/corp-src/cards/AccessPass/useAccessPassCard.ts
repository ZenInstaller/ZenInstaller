import { useCallback, useEffect, useState } from "react";
import { getMsal } from "../../auth/msal";
import { ACCESS_PASS_SCOPES } from "../../config/azureConfig";
import {
  listUsersManagedBySignedInUser,
  ensureTemporaryAccessPassEnabled,
  listUserAuthenticationMethods,
  resetUserPassword,
  deleteUserAuthenticationMethod,
  createTemporaryAccessPassForUser,
  temporaryAccessPassMethodExists,
  type EntraUser,
  type GraphAuthMethod,
} from "../../api/azureGraph";
import { isConsentError } from "../../logic/consent";
import { generateRandomPassword } from "./password";
import { createResultStorage } from "../../logic/resultStorage";
import { logEvent } from "./telemetry";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import type { CardHook, CardRequirements, CardStatus, SetupStep, AzureAccount } from "../../types";

export type AzureSetupResult = {
  accessPassValue: string;
  tenantId: string;
  targetUserId?: string;
  tapMethodId?: string;
};

function getAuthMethodDeletePath(userId: string, method: GraphAuthMethod): string | null {
  const methodType = method["@odata.type"]?.toLowerCase();

  if (methodType?.includes("passwordauthenticationmethod")) return null;

  if (methodType?.includes("emailauthenticationmethod"))
    return `/users/${userId}/authentication/emailMethods/${method.id}`;
  if (methodType?.includes("phoneauthenticationmethod"))
    return `/users/${userId}/authentication/phoneMethods/${method.id}`;
  if (methodType?.includes("microsoftauthenticatorauthenticationmethod"))
    return `/users/${userId}/authentication/microsoftAuthenticatorMethods/${method.id}`;
  if (methodType?.includes("fido2authenticationmethod"))
    return `/users/${userId}/authentication/fido2Methods/${method.id}`;
  if (methodType?.includes("softwareoathauthenticationmethod"))
    return `/users/${userId}/authentication/softwareOathMethods/${method.id}`;
  if (methodType?.includes("windowshelloforbusinessauthenticationmethod"))
    return `/users/${userId}/authentication/windowsHelloForBusinessMethods/${method.id}`;
  if (methodType?.includes("temporaryaccesspassauthenticationmethod"))
    return `/users/${userId}/authentication/temporaryAccessPassMethods/${method.id}`;

  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseAccessPassCardParams = {
  azureAccount: AzureAccount | null;
  // From useAzureAccount — this card locks behind azure_login, so both are set once it renders.
  confirmedTenantId: string | null;
};

export type AccessPassResult = { accessPassValue: string; tenantId: string; targetUserId: string; tapMethodId: string };

export interface UseAccessPassCard extends CardHook {
  readonly cardId: "access_pass";
  managerUsers: EntraUser[];
  selectedManagerUserId: string;
  setSelectedManagerUserId: (id: string) => void;
  managerUsersLoading: boolean;
  managerUsersError: string | null;
  consentRequired: boolean;
  requestAccessPassConsent: () => Promise<void>;
  steps: SetupStep[];
  running: boolean;
  result: AccessPassResult | null;
  runForUser: (targetUserId: string) => Promise<AccessPassResult | null>;
  reset: () => void;
  // Narrowed from CardHook (optional there) — every card provides these.
  cardRequirements: CardRequirements;
  cardDependencyLabel: string;
}

const RESULT_KEY = "zeninstaller_corp_access_pass_result";

const { save: saveResult, load: loadResult } = createResultStorage<AccessPassResult>(RESULT_KEY);

// Convert known error messages from the TAP creation API into user-friendly messages.
function toTapErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Failed";
  const lower = msg.toLowerCase();

  if (lower.includes("authenticationmethodspolicy") && lower.includes("403")) {
    return (
      "Not authorized to enable Temporary Access Pass for this tenant. " +
      "This requires the Authentication Policy Administrator role (a higher privilege than " +
      "creating a pass) — ask a tenant admin to enable it in Entra ID > Authentication methods " +
      "> Policies, or grant that role temporarily."
    );
  }

  if (lower.includes("403") && (lower.includes("temporaryaccesspassmethods") || lower.includes("accessdenied"))) {
    return (
      "Not authorized to create Temporary Access Pass. " +
      "Ensure your signed-in account has Authentication Administrator or Privileged Authentication Administrator role, " +
      "the app has delegated UserAuthenticationMethod.ReadWrite.All with admin consent, and Temporary Access Pass is enabled in Entra Authentication methods policy."
    );
  }

  if (lower.includes("aadsts65001") || lower.includes("interaction_required") || lower.includes("consent_required")) {
    return "Graph admin consent is required for this tenant. Reconnect Azure and grant consent, then try again.";
  }

  if (lower.includes("404") && lower.includes("temporaryaccesspassmethods")) {
    return "Selected user was not found in the current tenant context. Re-select the user and try again.";
  }

  if (lower.includes("authentication/methods") && lower.includes("403")) {
    return (
      "Not authorized to remove existing sign-in methods. " +
      "Ensure your account has Authentication Administrator or Privileged Authentication Administrator role, " +
      "and delegated UserAuthenticationMethod.ReadWrite.All has admin consent."
    );
  }

  if (lower.includes("passwordprofile") && lower.includes("403")) {
    return (
      "Not authorized to reset the user password. " +
      "Ensure your account has permissions to reset user passwords and delegated User.ReadWrite.All has admin consent."
    );
  }

  return msg;
}

/*
 * Creates a Microsoft Entra Temporary Access Pass for a user managed by the signed-in
 * account: remove their existing sign-in methods, randomize their password, then issue a
 * one-hour TAP. Reuses useAzureAccount's session — this card only ever renders once a
 * tenant is confirmed, since it's locked behind "azure_login".
 */
export function useAccessPassCard({ azureAccount, confirmedTenantId }: UseAccessPassCardParams): UseAccessPassCard {
  const { steps, setSteps, running, setRunning, updateStep, resetSteps } = useStepRunner();
  const [result, setResult] = useState<AccessPassResult | null>(loadResult);
  const [managerUsers, setManagerUsers] = useState<EntraUser[]>([]);
  const [selectedManagerUserId, setSelectedManagerUserId] = useState("");
  const [managerUsersLoading, setManagerUsersLoading] = useState(false);
  const [managerUsersError, setManagerUsersError] = useState<string | null>(null);
  const [consentRequired, setConsentRequired] = useState(false);

  const tenantId = confirmedTenantId || undefined;

  // Redirects for incremental consent (User.ReadWrite.All / UserAuthenticationMethod.ReadWrite.All /
  // Policy.ReadWrite.AuthenticationMethod / etc.); user re-runs after returning.
  const requestAccessPassConsent = useCallback(async () => {
    if (!azureAccount) return;
    const msal = await getMsal();
    if (!msal) return;
    await msal.acquireTokenRedirect({
      scopes: ACCESS_PASS_SCOPES,
      account: azureAccount,
      authority: `https://login.microsoftonline.com/${tenantId || azureAccount.tenantId}`,
    });
  }, [azureAccount, tenantId]);

  // Load Entra users managed by the signed-in user (direct reports) once a tenant is confirmed.
  useEffect(() => {
    if (!azureAccount || confirmedTenantId === null) return;
    let cancelled = false;
    setManagerUsersLoading(true);
    setManagerUsersError(null);
    setConsentRequired(false);
    listUsersManagedBySignedInUser(azureAccount, tenantId)
      .then((users) => {
        if (cancelled) return;
        setManagerUsers(users);
        setSelectedManagerUserId((prev) => (prev && users.some((u) => u.id === prev) ? prev : (users[0]?.id ?? "")));
      })
      .catch((err) => {
        if (cancelled) return;
        setManagerUsers([]);
        setSelectedManagerUserId("");
        const msg =
          err instanceof Error ? err.message : "No Entra users found that are managed by your signed-in account.";
        if (isConsentError(msg)) {
          setConsentRequired(true);
          setManagerUsersError(
            'Additional Microsoft Graph consent is required for this tenant. Click "Grant consent" below.',
          );
        } else {
          setManagerUsersError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setManagerUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [azureAccount, confirmedTenantId, tenantId]);

  // A persisted TAP could've been used up, revoked, or the user removed since last session —
  // confirm it still exists on Graph before trusting it, and hide it silently if not.
  useEffect(() => {
    if (!azureAccount || !result) return;
    let cancelled = false;
    temporaryAccessPassMethodExists(azureAccount, result.targetUserId, result.tapMethodId, result.tenantId || tenantId)
      .then((exists) => {
        if (!exists && !cancelled) {
          setResult(null);
          saveResult(null);
        }
      })
      .catch(() => {
        // Conservative behavior: hide stale/unknown value if TAP cannot be validated.
        if (!cancelled) {
          setResult(null);
          saveResult(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [azureAccount, result, tenantId]);

  const runForUser = useCallback(
    async (targetUserId: string): Promise<AccessPassResult | null> => {
      if (!azureAccount || !targetUserId) return null;
      setSelectedManagerUserId(targetUserId);
      setRunning(true);
      setConsentRequired(false);

      const initialSteps: SetupStep[] = [
        { id: "policy", label: "Ensure Temporary Access Pass Is Enabled", status: "pending" },
        { id: "removeMethods", label: "Remove Existing Login Methods", status: "pending" },
        { id: "rotatePassword", label: "Randomize User Password", status: "pending" },
        { id: "tap", label: "Create Temporary Access Pass", status: "pending" },
      ];
      setSteps(initialSteps);

      let currentStepId: SetupStep["id"] = "policy";
      try {
        updateStep("policy", "running");
        const justEnabled = await ensureTemporaryAccessPassEnabled(azureAccount, tenantId);
        updateStep(
          "policy",
          justEnabled ? "done" : "skipped",
          justEnabled ? "Enabled Temporary Access Pass for this tenant" : "Already enabled",
        );

        currentStepId = "removeMethods";
        updateStep("removeMethods", "running");
        const methods = await listUserAuthenticationMethods(azureAccount, targetUserId, tenantId);
        const deletePaths = methods
          .map((m) => getAuthMethodDeletePath(targetUserId, m))
          .filter((p): p is string => !!p);
        for (const path of deletePaths) {
          await deleteUserAuthenticationMethod(azureAccount, path, tenantId);
        }
        updateStep(
          "removeMethods",
          "done",
          deletePaths.length > 0
            ? `Removed ${deletePaths.length} existing method${deletePaths.length === 1 ? "" : "s"}`
            : "No removable methods found",
        );

        currentStepId = "rotatePassword";
        updateStep("rotatePassword", "running");
        const randomizedPassword = generateRandomPassword(30);
        await resetUserPassword(azureAccount, targetUserId, randomizedPassword, tenantId);
        updateStep("rotatePassword", "done", "Password randomized to a new 30-character value");

        currentStepId = "tap";
        updateStep("tap", "running");
        const tap = await createTemporaryAccessPassForUser(azureAccount, targetUserId, tenantId);
        updateStep("tap", "done", "Temporary Access Pass created");

        const r: AccessPassResult = {
          accessPassValue: tap.temporaryAccessPass,
          tenantId: tenantId ?? azureAccount.tenantId,
          targetUserId,
          tapMethodId: tap.id,
        };
        setResult(r);
        saveResult(r);
        return r;
      } catch (err) {
        logEvent("accessPassWorkflowStepFailed", {
          targetUserId,
          stepId: currentStepId,
          message: err instanceof Error ? err.message : String(err),
        });
        const msg = err instanceof Error ? err.message : "Failed";
        if (isConsentError(msg)) {
          setConsentRequired(true);
          updateStep(
            currentStepId,
            "error",
            'Additional consent required — click "Grant consent" below, then try again.',
          );
        } else {
          updateStep(currentStepId, "error", toTapErrorMessage(err));
        }
        return null;
      } finally {
        setRunning(false);
      }
    },
    [azureAccount, tenantId, setSteps, setRunning, updateStep],
  );

  const reset = useCallback(() => {
    resetSteps();
    setResult(null);
    saveResult(null);
  }, [resetSteps]);

  // Assumes prerequisites are met — App locks this card (via cardRequirements) whenever they're not.
  const status: CardStatus = managerUsersError || managerUsers.length === 0 ? "warning" : result ? "complete" : "idle";
  const summary = result
    ? "Access pass created"
    : managerUsersLoading
      ? "Loading users..."
      : managerUsers.length > 0
        ? "Select a user and create an access pass"
        : "No users available";

  return {
    cardId: "access_pass" as const,
    managerUsers,
    selectedManagerUserId,
    setSelectedManagerUserId,
    managerUsersLoading,
    managerUsersError,
    consentRequired,
    requestAccessPassConsent,
    steps,
    running,
    result,
    runForUser,
    reset,
    status,
    summary,
    cardRequirements: ["azure_login"],
    cardDependencyLabel: "Sign in to Azure",
    done: !!result,
  };
}
