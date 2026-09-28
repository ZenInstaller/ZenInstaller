import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAzureAccount, type UseAzureAccount } from "../cards/AzureLogin/useAzureAccount";
import type { AzureAccount } from "../types";

async function waitFor(assertion: () => void, timeoutMs = 1000) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getMsal: vi.fn(),
    listTenants: vi.fn(),
    getToken: vi.fn(),
  },
}));

vi.mock("../auth/msal", () => ({
  getMsal: apiMocks.getMsal,
  getToken: apiMocks.getToken,
  MSA_TENANT: "msa-tenant",
}));

vi.mock("../api/azureGraph", () => ({
  listTenants: apiMocks.listTenants,
}));

vi.mock("../config/azureConfig", () => ({
  LOGIN_SCOPES: ["login.scope"],
  ARM_SCOPES: ["arm.scope"],
}));

function HookHarness(props: { onUpdate: (value: UseAzureAccount) => void }) {
  const value = useAzureAccount();
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

describe("useAzureAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    apiMocks.listTenants.mockResolvedValue([{ tenantId: "tenant-1", displayName: "Tenant One" }]);
    apiMocks.getToken.mockResolvedValue("arm-token");
  });

  it("restores an existing account, confirms ARM, and supports login/logout", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
    } as AzureAccount;
    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };
    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account?.username).toBe("org@example.com");
    expect(latest?.tenants).toEqual([{ tenantId: "tenant-1", displayName: "Tenant One" }]);
    expect(latest?.confirmedTenantId).toBe("");
    expect(latest?.tenantsLoaded).toBe(true);
    expect(latest?.loggingIn).toBe(false);

    await act(async () => {
      await latest?.login();
    });
    expect(msal.loginRedirect).toHaveBeenCalled();

    await act(async () => {
      await latest?.logout();
    });

    expect(msal.clearCache).toHaveBeenCalled();
    expect(latest?.account).toBeNull();
    expect(latest?.tenants).toEqual([]);
    expect(latest?.manualTenantId).toBe("");
    expect(latest?.confirmedTenantId).toBeNull();
    expect(latest?.tenantIdError).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows an error when confirming an empty tenant ID", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["", {}],
        ["tenant-1", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("");
    });

    await waitFor(() => {
      expect(latest?.tenantIdError).toBe("Please enter your Tenant ID");
    });

    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows a membership guidance error for AADSTS90072 failures", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("AADSTS90072: User is not a member of this tenant")),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(latest?.tenantIdError).toBe(
        "This account isn't a member of that tenant — sign in with a different account, or have an admin add it as a guest first.",
      );
    });

    expect(msal.loginRedirect).not.toHaveBeenCalled();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("shows a generic tenant error for non-consent failures", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("Network timeout")),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(latest?.tenantIdError).toBe(
        "Couldn't reach that tenant — check the tenant ID or your access, then try again.",
      );
    });

    expect(msal.loginRedirect).not.toHaveBeenCalled();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("finishes loading with no account when no existing MSAL account exists", async () => {
    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account).toBeNull();
    expect(latest?.tenants).toEqual([]);
    expect(latest?.confirmedTenantId).toBeNull();
    expect(latest?.tenantsLoaded).toBe(false);
    expect(latest?.loggingIn).toBe(false);

    expect(apiMocks.getToken).not.toHaveBeenCalled();
    expect(apiMocks.listTenants).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("restores the account returned from the MSAL redirect", async () => {
    const account = {
      username: "redirect@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue({ account }),
      getAllAccounts: vi.fn().mockReturnValue([]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account?.username).toBe("redirect@example.com");
    expect(latest?.tenants).toEqual([{ tenantId: "tenant-1", displayName: "Tenant One" }]);
    expect(latest?.confirmedTenantId).toBe("");
    expect(latest?.loggingIn).toBe(false);

    expect(msal.handleRedirectPromise).toHaveBeenCalled();
    expect(msal.getAllAccounts).not.toHaveBeenCalled();

    expect(apiMocks.getToken).toHaveBeenCalledWith(account, ["arm.scope"], undefined);

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to tenant profiles when the ARM tenant list cannot be loaded", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
        ["msa-tenant", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);
    apiMocks.listTenants.mockRejectedValueOnce(new Error("ARM tenant request failed"));

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account?.username).toBe("org@example.com");

    expect(latest?.tenants).toEqual([
      { tenantId: "tenant-1", displayName: "tenant-1" },
      { tenantId: "tenant-2", displayName: "tenant-2" },
    ]);

    expect(latest?.tenantsLoaded).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("automatically selects the first available tenant for an MSA account", async () => {
    const account = {
      username: "personal@example.com",
      tenantId: "msa-tenant",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["msa-tenant", {}],
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);
    apiMocks.listTenants.mockRejectedValueOnce(new Error("ARM tenant request failed"));

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account?.username).toBe("personal@example.com");

    expect(latest?.tenants).toEqual([
      { tenantId: "tenant-1", displayName: "tenant-1" },
      { tenantId: "tenant-2", displayName: "tenant-2" },
    ]);

    expect(latest?.manualTenantId).toBe("tenant-1");
    expect(latest?.confirmedTenantId).toBe("tenant-1");
    expect(latest?.tenantsLoaded).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("confirms a selected tenant using a silent ARM token", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: ["arm.scope"],
      account,
      authority: "https://login.microsoftonline.com/tenant-2",
    });
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    expect(latest?.manualTenantId).toBe("tenant-2");
    expect(latest?.confirmedTenantId).toBe("tenant-2");
    expect(latest?.tenantIdError).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("redirects immediately when selecting a tenant missing from tenantProfiles", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([["tenant-1", {}]]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(msal.acquireTokenRedirect).toHaveBeenCalledWith({
        account,
        scopes: ["arm.scope"],
        authority: "https://login.microsoftonline.com/tenant-2",
      });
    });

    await waitFor(() => {
      expect(latest?.manualTenantId).toBe("tenant-2");
      expect(latest?.tenantIdError).toBeNull();
      expect(latest?.confirmedTenantId).toBe("tenant-2");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not call acquireTokenRedirect when selecting a missing tenant and MSAL is unavailable", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([["tenant-1", {}]]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValueOnce(msal).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(latest?.manualTenantId).toBe("tenant-2");
      expect(latest?.tenantIdError).toBeNull();
    });

    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("redirects for tenant consent when silent ARM token requires interaction", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("interaction_required")),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(msal.loginRedirect).toHaveBeenCalledWith({
        scopes: ["arm.scope"],
        authority: "https://login.microsoftonline.com/tenant-2",
        prompt: "consent",
      });
    });

    expect(sessionStorage.getItem("zeninstaller_arm_tenant")).toBe("tenant-2");
    expect(latest?.tenantIdError).toBeNull();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("clears saved tenant and sets an error when consent redirect fails", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockRejectedValue(new Error("Consent redirect failed")),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("AADSTS65001: interaction_required")),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("org@example.com");
    });

    await act(async () => {
      latest?.selectTenant("tenant-2");
    });

    await waitFor(() => {
      expect(latest?.tenantIdError).toBe("Consent redirect failed");
    });

    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: ["arm.scope"],
      authority: "https://login.microsoftonline.com/tenant-2",
      prompt: "consent",
    });
    expect(sessionStorage.getItem("zeninstaller_arm_tenant")).toBeNull();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("redirects for ARM consent when the saved tenant requires interaction", async () => {
    sessionStorage.setItem("zeninstaller_arm_tenant", "tenant-1");

    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    apiMocks.getToken.mockRejectedValueOnce(new Error("AADSTS65001: interaction_required"));

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(msal.acquireTokenRedirect).toHaveBeenCalledWith({
      scopes: ["arm.scope"],
      authority: "https://login.microsoftonline.com/tenant-1",
    });

    expect(latest?.manualTenantId).toBe("tenant-1");
    expect(latest?.confirmedTenantId).toBeNull();
    expect(latest?.loggingIn).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("sets a login error when the MSAL login redirect fails", async () => {
    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([]),
      loginRedirect: vi.fn().mockRejectedValue(new Error("Microsoft login failed")),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await latest?.login();
    });

    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: ["login.scope"],
      authority: "https://login.microsoftonline.com/common",
      prompt: "select_account",
    });

    expect(latest?.loginError).toBe("Microsoft login failed");

    consoleError.mockRestore();

    await act(async () => {
      root.unmount();
    });
  });

  it("login is a no-op when MSAL is unavailable", async () => {
    apiMocks.getMsal.mockResolvedValue(null);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      await latest?.login();
    });

    expect(latest?.loginError).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to tenant profiles when the ARM tenant list resolves empty", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["tenant-1", {}],
        ["tenant-2", {}],
        ["msa-tenant", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);
    apiMocks.listTenants.mockResolvedValueOnce([]);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.tenants).toEqual([
      { tenantId: "tenant-1", displayName: "tenant-1" },
      { tenantId: "tenant-2", displayName: "tenant-2" },
    ]);
    expect(latest?.tenantsLoaded).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("MSA auto-select does not override a manualTenantId already restored from a saved session", async () => {
    localStorage.setItem("zeninstaller_azure_result", JSON.stringify({ tenantId: "tenant-2" }));

    const account = {
      username: "personal@example.com",
      tenantId: "msa-tenant",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([
        ["msa-tenant", {}],
        ["tenant-1", {}],
        ["tenant-2", {}],
      ]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.manualTenantId).toBe("tenant-2");
    });

    // The saved tenant (not availableTenants[0] === "tenant-1") must stick — auto-select only
    // fires when manualTenantId is still blank.
    expect(latest?.manualTenantId).not.toBe("tenant-1");
    expect(apiMocks.getToken).toHaveBeenCalledWith(account, ["arm.scope"], "tenant-2");

    await act(async () => {
      root.unmount();
    });
  });

  it("MSA auto-select does nothing when the account has no other tenant profiles", async () => {
    const account = {
      username: "personal@example.com",
      tenantId: "msa-tenant",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
      tenantProfiles: new Map([["msa-tenant", {}]]) as AzureAccount["tenantProfiles"],
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.account?.username).toBe("personal@example.com");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.manualTenantId).toBe("");
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("confirms ARM against the saved tenant on init and clears the session key", async () => {
    sessionStorage.setItem("zeninstaller_arm_tenant", "tenant-1");

    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(apiMocks.getToken).toHaveBeenCalledWith(account, ["arm.scope"], "tenant-1");
    expect(latest?.confirmedTenantId).toBe("tenant-1");
    expect(sessionStorage.getItem("zeninstaller_arm_tenant")).toBeNull();
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("silently swallows a non-consent ARM confirmation failure on init", async () => {
    const account = {
      username: "org@example.com",
      tenantId: "tenant-1",
      homeAccountId: "home",
      environment: "login.microsoftonline.com",
      localAccountId: "local",
    } as AzureAccount;

    const msal = {
      handleRedirectPromise: vi.fn().mockResolvedValue(null),
      getAllAccounts: vi.fn().mockReturnValue([account]),
      loginRedirect: vi.fn().mockResolvedValue(undefined),
      acquireTokenSilent: vi.fn().mockResolvedValue(undefined),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };

    apiMocks.getMsal.mockResolvedValue(msal);
    apiMocks.getToken.mockRejectedValueOnce(new Error("Network timeout"));

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account?.username).toBe("org@example.com");
    expect(latest?.confirmedTenantId).toBeNull();
    expect(latest?.loggingIn).toBe(false);
    expect(msal.acquireTokenRedirect).not.toHaveBeenCalled();
    expect(msal.loginRedirect).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("finishes loading when MSAL is unavailable", async () => {
    apiMocks.getMsal.mockResolvedValue(null);

    let latest: UseAzureAccount | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest?.account).toBeNull();
    expect(latest?.tenants).toEqual([]);
    expect(latest?.confirmedTenantId).toBeNull();
    expect(latest?.loggingIn).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
