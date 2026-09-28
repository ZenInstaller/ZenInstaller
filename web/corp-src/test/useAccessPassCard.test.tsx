import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccessPassCard, type UseAccessPassCard } from "../cards/AccessPass/useAccessPassCard";
import type { AzureAccount } from "../types";

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getMsal: vi.fn(),
    listUsersManagedBySignedInUser: vi.fn(),
    ensureTemporaryAccessPassEnabled: vi.fn(),
    listUserAuthenticationMethods: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUserAuthenticationMethod: vi.fn(),
    createTemporaryAccessPassForUser: vi.fn(),
    temporaryAccessPassMethodExists: vi.fn(),
    isConsentError: vi.fn(),
    generateRandomPassword: vi.fn(),
    logEvent: vi.fn(),
  },
}));

vi.mock("../auth/msal", () => ({
  getMsal: apiMocks.getMsal,
}));

vi.mock("../api/azureGraph", () => ({
  listUsersManagedBySignedInUser: apiMocks.listUsersManagedBySignedInUser,
  ensureTemporaryAccessPassEnabled: apiMocks.ensureTemporaryAccessPassEnabled,
  listUserAuthenticationMethods: apiMocks.listUserAuthenticationMethods,
  resetUserPassword: apiMocks.resetUserPassword,
  deleteUserAuthenticationMethod: apiMocks.deleteUserAuthenticationMethod,
  createTemporaryAccessPassForUser: apiMocks.createTemporaryAccessPassForUser,
  temporaryAccessPassMethodExists: apiMocks.temporaryAccessPassMethodExists,
}));

vi.mock("../logic/consent", () => ({
  isConsentError: apiMocks.isConsentError,
}));

vi.mock("../cards/AccessPass/password", () => ({
  generateRandomPassword: apiMocks.generateRandomPassword,
}));

vi.mock("../cards/AccessPass/telemetry", () => ({
  logEvent: apiMocks.logEvent,
}));

vi.mock("../config/azureConfig", () => ({
  ACCESS_PASS_SCOPES: ["scope.a", "scope.b"],
}));

function HookHarness(
  props: {
    onUpdate: (value: UseAccessPassCard) => void;
  } & Parameters<typeof useAccessPassCard>[0],
) {
  const value = useAccessPassCard(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

async function waitFor(assertion: () => void, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) throw error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}

function baseProps(
  overrides: Partial<Parameters<typeof useAccessPassCard>[0]> = {},
): Parameters<typeof useAccessPassCard>[0] {
  return {
    azureAccount: { tenantId: "tenant-a", homeAccountId: "h1", environment: "login.microsoftonline.com", username: "user@contoso.com", localAccountId: "l1", name: "User" } as AzureAccount,
    confirmedTenantId: "tenant-a",
    ...overrides,
  };
}

describe("useAccessPassCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    apiMocks.getMsal.mockResolvedValue({
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    });
    apiMocks.listUsersManagedBySignedInUser.mockResolvedValue([
      { id: "u1", displayName: "User One", userPrincipalName: "u1@contoso.com" },
      { id: "u2", displayName: "User Two", userPrincipalName: "u2@contoso.com" },
    ]);
    apiMocks.ensureTemporaryAccessPassEnabled.mockResolvedValue(false);
    apiMocks.listUserAuthenticationMethods.mockResolvedValue([]);
    apiMocks.resetUserPassword.mockResolvedValue(undefined);
    apiMocks.deleteUserAuthenticationMethod.mockResolvedValue(undefined);
    apiMocks.createTemporaryAccessPassForUser.mockResolvedValue({
      id: "tap-1",
      temporaryAccessPass: "TAP-SECRET",
    });
    apiMocks.temporaryAccessPassMethodExists.mockResolvedValue(true);
    apiMocks.isConsentError.mockReturnValue(false);
    apiMocks.generateRandomPassword.mockReturnValue("RANDOM-PASSWORD");
    apiMocks.logEvent.mockReturnValue(undefined);
  });

  it("requestAccessPassConsent returns early without account or msal, then redirects with tenant authority", async () => {
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null, confirmedTenantId: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.requestAccessPassConsent();
    });

    expect(apiMocks.getMsal).not.toHaveBeenCalled();

    apiMocks.getMsal.mockResolvedValueOnce(null);
    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.requestAccessPassConsent();
    });

    expect(apiMocks.getMsal).toHaveBeenCalled();

    const acquireTokenRedirect = vi.fn().mockResolvedValue(undefined);
    apiMocks.getMsal.mockResolvedValueOnce({ acquireTokenRedirect });

    await act(async () => {
      await latest?.requestAccessPassConsent();
    });

    expect(acquireTokenRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["scope.a", "scope.b"],
        authority: "https://login.microsoftonline.com/tenant-a",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("loads manager users, preserves previous selection if still present, else falls back to first", async () => {
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsers).toHaveLength(2);
      expect(latest?.selectedManagerUserId).toBe("u1");
    });

    await act(async () => {
      latest?.setSelectedManagerUserId("u2");
    });

    await waitFor(() => {
      expect(latest?.selectedManagerUserId).toBe("u2");
    });

    apiMocks.listUsersManagedBySignedInUser.mockResolvedValueOnce([
      { id: "u2", displayName: "User Two", userPrincipalName: "u2@contoso.com" },
      { id: "u3", displayName: "User Three", userPrincipalName: "u3@contoso.com" },
    ]);

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-b" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.selectedManagerUserId).toBe("u2");
    });

    apiMocks.listUsersManagedBySignedInUser.mockResolvedValueOnce([
      { id: "u9", displayName: "User Nine", userPrincipalName: "u9@contoso.com" },
    ]);

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-c" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.selectedManagerUserId).toBe("u9");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("handles list users guard and consent/non-consent error branches", async () => {
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null, confirmedTenantId: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    expect(apiMocks.listUsersManagedBySignedInUser).not.toHaveBeenCalled();

    apiMocks.listUsersManagedBySignedInUser.mockRejectedValueOnce(new Error("AADSTS65001 consent_required"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("AADSTS65001"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.consentRequired).toBe(true);
      expect(latest?.managerUsersError).toContain("Additional Microsoft Graph consent is required");
      expect(latest?.managerUsers).toEqual([]);
      expect(latest?.selectedManagerUserId).toBe("");
    });

    apiMocks.listUsersManagedBySignedInUser.mockRejectedValueOnce(new Error("backend down"));
    apiMocks.isConsentError.mockReturnValue(false);
    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-z" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.consentRequired).toBe(false);
      expect(latest?.managerUsersError).toBe("backend down");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("hides stale persisted TAP result when method no longer exists or validation fails", async () => {    localStorage.setItem(
      "zeninstaller_corp_access_pass_result",
      JSON.stringify({
        accessPassValue: "persisted",
        tenantId: "tenant-a",
        targetUserId: "u1",
        tapMethodId: "tap-1",
      }),
    );

    apiMocks.temporaryAccessPassMethodExists.mockResolvedValueOnce(false);
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.result).toBeNull();
      expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });

    localStorage.setItem(
      "zeninstaller_corp_access_pass_result",
      JSON.stringify({
        accessPassValue: "persisted2",
        tenantId: "tenant-a",
        targetUserId: "u1",
        tapMethodId: "tap-2",
      }),
    );

    apiMocks.temporaryAccessPassMethodExists.mockRejectedValueOnce(new Error("graph fail"));
    latest = null;
    const root2 = createRoot(document.createElement("div"));
    await act(async () => {
      root2.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-b" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.result).toBeNull();
      expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).toBeNull();
    });

    await act(async () => {
      root2.unmount();
    });
  });

  it("skips validating a persisted TAP result when there is no signed-in account", async () => {
    localStorage.setItem(
      "zeninstaller_corp_access_pass_result",
      JSON.stringify({
        accessPassValue: "persisted",
        tenantId: "tenant-a",
        targetUserId: "u1",
        tapMethodId: "tap-1",
      }),
    );

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null, confirmedTenantId: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(apiMocks.temporaryAccessPassMethodExists).not.toHaveBeenCalled();
    expect(latest?.result?.accessPassValue).toBe("persisted");
    expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a persisted TAP result once its method is confirmed to still exist", async () => {
    localStorage.setItem(
      "zeninstaller_corp_access_pass_result",
      JSON.stringify({
        accessPassValue: "persisted",
        tenantId: "tenant-a",
        targetUserId: "u1",
        tapMethodId: "tap-1",
      }),
    );
    apiMocks.temporaryAccessPassMethodExists.mockResolvedValueOnce(true);

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsersLoading).toBe(false);
    });

    expect(apiMocks.temporaryAccessPassMethodExists).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "tap-1",
      "tenant-a",
    );
    expect(latest?.result?.accessPassValue).toBe("persisted");
    expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to a generic message when a non-Error is thrown while loading manager users", async () => {
    apiMocks.listUsersManagedBySignedInUser.mockRejectedValueOnce("plain string rejection");

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsersLoading).toBe(false);
      expect(latest?.consentRequired).toBe(false);
      expect(latest?.managerUsersError).toBe("No Entra users found that are managed by your signed-in account.");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("discards a stale manager-users load when the tenant changes before it resolves", async () => {
    let resolveFirst!: (users: Array<{ id: string; displayName: string; userPrincipalName: string }>) => void;
    apiMocks.listUsersManagedBySignedInUser.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    apiMocks.listUsersManagedBySignedInUser.mockResolvedValueOnce([
      { id: "u9", displayName: "User Nine", userPrincipalName: "u9@contoso.com" },
    ]);
    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-b" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsersLoading).toBe(false);
      expect(latest?.managerUsers).toEqual([{ id: "u9", displayName: "User Nine", userPrincipalName: "u9@contoso.com" }]);
    });

    // The stale tenant-a lookup resolving afterwards must not overwrite the tenant-b result.
    await act(async () => {
      resolveFirst([{ id: "stale", displayName: "Stale", userPrincipalName: "stale@contoso.com" }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(latest?.managerUsers).toEqual([{ id: "u9", displayName: "User Nine", userPrincipalName: "u9@contoso.com" }]);

    await act(async () => {
      root.unmount();
    });
  });

  it("reports 'Loading users...' as the summary while manager users are being fetched", async () => {
    let resolveUsers!: (users: Array<{ id: string; displayName: string; userPrincipalName: string }>) => void;
    apiMocks.listUsersManagedBySignedInUser.mockImplementationOnce(
      () => new Promise((resolve) => { resolveUsers = resolve; }),
    );

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    expect(latest?.managerUsersLoading).toBe(true);
    expect(latest?.summary).toBe("Loading users...");

    await act(async () => {
      resolveUsers([{ id: "u1", displayName: "User One", userPrincipalName: "u1@contoso.com" }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("reports whether the Temporary Access Pass policy was just enabled or already enabled", async () => {
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsers).toHaveLength(2);
    });

    apiMocks.ensureTemporaryAccessPassEnabled.mockResolvedValueOnce(true);
    await act(async () => {
      await latest?.runForUser("u1");
    });
    expect(latest?.steps.find((s) => s.id === "policy")).toMatchObject({
      status: "done",
      detail: "Enabled Temporary Access Pass for this tenant",
    });

    apiMocks.ensureTemporaryAccessPassEnabled.mockResolvedValueOnce(false);
    await act(async () => {
      await latest?.runForUser("u1");
    });
    expect(latest?.steps.find((s) => s.id === "policy")).toMatchObject({
      status: "skipped",
      detail: "Already enabled",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("runForUser maps auth method types to delete paths and completes workflow", async () => {
    apiMocks.ensureTemporaryAccessPassEnabled.mockResolvedValueOnce(true);
    apiMocks.listUserAuthenticationMethods.mockResolvedValueOnce([
      { id: "m-pass", "@odata.type": "#microsoft.graph.passwordAuthenticationMethod" },
      { id: "m-email", "@odata.type": "#microsoft.graph.emailAuthenticationMethod" },
      { id: "m-phone", "@odata.type": "#microsoft.graph.phoneAuthenticationMethod" },
      { id: "m-ma", "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod" },
      { id: "m-fido2", "@odata.type": "#microsoft.graph.fido2AuthenticationMethod" },
      { id: "m-oath", "@odata.type": "#microsoft.graph.softwareOathAuthenticationMethod" },
      { id: "m-whfb", "@odata.type": "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod" },
      { id: "m-tap", "@odata.type": "#microsoft.graph.temporaryAccessPassAuthenticationMethod" },
      { id: "m-unknown", "@odata.type": "#microsoft.graph.someUnknownType" },
      { id: "m-none" },
    ]);

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.managerUsers).toHaveLength(2);
    });

    let runResult = null;
    await act(async () => {
      runResult = await latest?.runForUser("u1");
    });

    expect(runResult).toEqual({
      accessPassValue: "TAP-SECRET",
      tenantId: "tenant-a",
      targetUserId: "u1",
      tapMethodId: "tap-1",
    });

    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledTimes(7);
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/emailMethods/m-email",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/phoneMethods/m-phone",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/microsoftAuthenticatorMethods/m-ma",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/fido2Methods/m-fido2",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/softwareOathMethods/m-oath",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/windowsHelloForBusinessMethods/m-whfb",
      "tenant-a",
    );
    expect(apiMocks.deleteUserAuthenticationMethod).toHaveBeenCalledWith(
      expect.anything(),
      "/users/u1/authentication/temporaryAccessPassMethods/m-tap",
      "tenant-a",
    );

    await waitFor(() => {
      expect(latest?.steps.find((s) => s.id === "policy")?.status).toBe("done");
      expect(latest?.steps.find((s) => s.id === "removeMethods")?.detail).toBe("Removed 7 existing methods");
      expect(latest?.steps.find((s) => s.id === "rotatePassword")?.status).toBe("done");
      expect(latest?.steps.find((s) => s.id === "tap")?.status).toBe("done");
      expect(latest?.result?.tapMethodId).toBe("tap-1");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("runForUser handles no-account/empty-user guard and no-removable-methods branch", async () => {
    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let r1 = "unset" as unknown;
    await act(async () => {
      r1 = await latest?.runForUser("u1");
    });
    expect(r1).toBeNull();

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let r2 = "unset" as unknown;
    await act(async () => {
      r2 = await latest?.runForUser("");
    });
    expect(r2).toBeNull();

    apiMocks.listUserAuthenticationMethods.mockResolvedValueOnce([]);
    await act(async () => {
      await latest?.runForUser("u1");
    });

    await waitFor(() => {
      expect(latest?.steps.find((s) => s.id === "removeMethods")?.detail).toBe("No removable methods found");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("maps known TAP error messages to user-friendly step errors", async () => {
    const root = createRoot(document.createElement("div"));
    let latest: UseAccessPassCard | null = null;

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    const cases = [
      {
        msg: "403 authenticationMethodsPolicy denied",
        expected: "Not authorized to enable Temporary Access Pass for this tenant.",
      },
      {
        msg: "403 temporaryAccessPassMethods accessDenied",
        expected: "Not authorized to create Temporary Access Pass.",
      },
      {
        msg: "AADSTS65001 interaction_required",
        expected: "Graph admin consent is required for this tenant.",
      },
      {
        msg: "404 temporaryAccessPassMethods missing",
        expected: "Selected user was not found in the current tenant context.",
      },
      {
        msg: "403 authentication/methods denied",
        expected: "Not authorized to remove existing sign-in methods.",
      },
      {
        msg: "403 passwordProfile denied",
        expected: "Not authorized to reset the user password.",
      },
    ];

    for (const c of cases) {
      apiMocks.ensureTemporaryAccessPassEnabled.mockRejectedValueOnce(new Error(c.msg));
      await act(async () => {
        await latest?.runForUser("u1");
      });
      await waitFor(() => {
        expect(latest?.steps.find((s) => s.id === "policy")?.status).toBe("error");
        expect(latest?.steps.find((s) => s.id === "policy")?.detail).toContain(c.expected);
      });
    }

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to a generic 'Failed' detail when a non-Error value is thrown", async () => {
    apiMocks.ensureTemporaryAccessPassEnabled.mockRejectedValueOnce("plain string rejection");
    apiMocks.isConsentError.mockReturnValue(false);

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.runForUser("u1");
    });

    await waitFor(() => {
      expect(latest?.steps.find((s) => s.id === "policy")?.status).toBe("error");
      expect(latest?.steps.find((s) => s.id === "policy")?.detail).toBe("Failed");
    });

    expect(apiMocks.logEvent).toHaveBeenCalledWith(
      "accessPassWorkflowStepFailed",
      expect.objectContaining({ targetUserId: "u1", stepId: "policy", message: "plain string rejection" }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("handles consent error branch in runForUser catch and logs failure", async () => {
    apiMocks.ensureTemporaryAccessPassEnabled.mockRejectedValueOnce(new Error("consent_required"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("consent_required"));

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.runForUser("u1");
    });

    await waitFor(() => {
      expect(latest?.consentRequired).toBe(true);
      expect(latest?.steps.find((s) => s.id === "policy")?.detail).toContain("Additional consent required");
      expect(latest?.running).toBe(false);
    });

    expect(apiMocks.logEvent).toHaveBeenCalledWith(
      "accessPassWorkflowStepFailed",
      expect.objectContaining({ targetUserId: "u1", stepId: "policy" }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("reset clears steps and persisted result; summary/status branches match state", async () => {
    apiMocks.listUsersManagedBySignedInUser.mockResolvedValueOnce([]);

    let latest: UseAccessPassCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.status).toBe("warning");
      expect(latest?.summary).toBe("No users available");
    });

    apiMocks.listUsersManagedBySignedInUser.mockResolvedValueOnce([
      { id: "u1", displayName: "User One", userPrincipalName: "u1@contoso.com" },
    ]);

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ confirmedTenantId: "tenant-2" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.status).toBe("idle");
      expect(latest?.summary).toBe("Select a user and create an access pass");
    });

    await act(async () => {
      await latest?.runForUser("u1");
    });

    await waitFor(() => {
      expect(latest?.status).toBe("complete");
      expect(latest?.summary).toBe("Access pass created");
      expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).not.toBeNull();
    });

    await act(async () => {
      latest?.reset();
    });

    await waitFor(() => {
      expect(latest?.steps).toEqual([]);
      expect(latest?.result).toBeNull();
      expect(localStorage.getItem("zeninstaller_corp_access_pass_result")).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });
});
