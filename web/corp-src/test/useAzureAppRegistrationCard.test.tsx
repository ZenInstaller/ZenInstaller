import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AzureAccount } from "../types";
import {
  useAzureAppRegistrationCard,
  type UseAzureAppRegistrationCard,
} from "../cards/AzureAppRegistration/useAzureAppRegistrationCard";

async function waitFor(assertion: () => void, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  // Out of time: one last go, so what surfaces is the assertion's own error.
  assertion();
}

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getMsal: vi.fn(),
    ensureScopeConsent: vi.fn(),
    getExistingApp: vi.fn(),
    getAppNameByAppId: vi.fn(),
    createAppRegistration: vi.fn(),
    getExistingSP: vi.fn(),
    createServicePrincipal: vi.fn(),
    ensureFederatedCredential: vi.fn(),
    setOidcImmutableSubject: vi.fn(),
    ensureRbacRole: vi.fn(),
    isConsentError: vi.fn(),
    rbacStatus: "ready" as const,
    rbacMissingRoles: [] as string[],
  },
}));

vi.mock("../auth/msal", () => ({
  getMsal: apiMocks.getMsal,
  ensureScopeConsent: apiMocks.ensureScopeConsent,
}));

vi.mock("../api", () => ({
  setOidcImmutableSubject: apiMocks.setOidcImmutableSubject,
}));

vi.mock("../api/azureGraph", () => ({
  getExistingApp: apiMocks.getExistingApp,
  getAppNameByAppId: apiMocks.getAppNameByAppId,
  createAppRegistration: apiMocks.createAppRegistration,
  getExistingSP: apiMocks.getExistingSP,
  createServicePrincipal: apiMocks.createServicePrincipal,
  ensureFederatedCredential: apiMocks.ensureFederatedCredential,
  ensureRbacRole: apiMocks.ensureRbacRole,
}));

vi.mock("../logic/consent", () => ({
  isConsentError: apiMocks.isConsentError,
}));

vi.mock("../cards/AzureAppRegistration/useRbacCheck", () => ({
  useRbacCheck: vi.fn(() => ({ status: apiMocks.rbacStatus, missingRoles: apiMocks.rbacMissingRoles })),
}));

vi.mock("../config/azureConfig", () => ({
  AZURE_CLIENT_ID: "client-id",
  APP_SCOPES: ["app.scope"],
  ARM_SCOPES: ["arm.scope"],
}));

vi.mock("../config/githubConfig", () => ({
  VALID_ENVS: ["PROD", "TEST"],
}));

function HookHarness(
  props: {
    onUpdate: (value: UseAzureAppRegistrationCard) => void;
  } & Parameters<typeof useAzureAppRegistrationCard>[0],
) {
  const value = useAzureAppRegistrationCard(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

function baseProps(
  overrides: Partial<Parameters<typeof useAzureAppRegistrationCard>[0]> = {},
): Parameters<typeof useAzureAppRegistrationCard>[0] {
  return {
    azureAccount: { tenantId: "tenant-home" } as AzureAccount,
    githubAccount: { id: 1, login: "org-one", type: "User" },
    githubRepo: "repo-one",
    githubRepoId: 456789,
    subscriptionId: "sub-1",
    subscriptionLabel: "Main subscription",
    tenantId: "tenant-1",
    variableValues: {},
    manualTenantId: "",
    ...overrides,
  };
}

describe("useAzureAppRegistrationCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    apiMocks.getExistingApp.mockResolvedValue({ appId: "existing-app", id: "app-obj" });
    apiMocks.getAppNameByAppId.mockResolvedValue("Prefilled App");
    apiMocks.createAppRegistration.mockResolvedValue({ appId: "created-app", id: "app-created" });
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-existing" });
    apiMocks.createServicePrincipal.mockResolvedValue({ id: "sp-created" });
    apiMocks.ensureScopeConsent.mockResolvedValue(false);
    apiMocks.ensureFederatedCredential.mockResolvedValue(undefined);
    apiMocks.ensureRbacRole.mockResolvedValue(undefined);
    apiMocks.isConsentError.mockReturnValue(false);
    apiMocks.getMsal.mockResolvedValue({
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    });
    apiMocks.rbacStatus = "ready";
    apiMocks.rbacMissingRoles = [];
  });

  it("uses default environments when pipeline valid envs include PROD/TEST", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
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

    expect(latest?.environments).toEqual(["PROD", "TEST"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to PROD/TEST when pipeline valid envs do not include them", async () => {
    const includesSpy = vi.spyOn(Array.prototype, "includes").mockImplementation(function (
      this: string[],
      value: string,
    ) {
      if (this.length === 2 && this[0] === "PROD" && this[1] === "TEST") {
        return false;
      }
      return this.indexOf(value) >= 0;
    });

    let latest: UseAzureAppRegistrationCard | null = null;
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

    expect(latest?.environments).toEqual(["PROD", "TEST"]);
    expect(includesSpy).toHaveBeenCalled();
    includesSpy.mockRestore();

    await act(async () => {
      root.unmount();
    });
  });

  it("derives client ids from variable values first, then reports mismatch drift", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({
            variableValues: {
              AZURE_CLIENT_ID: "client-a",
              AZURE_PLAN_CLIENT_ID: "client-b",
            },
          })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    expect(latest?.spClientId).toBe("client-a");
    expect(latest?.planClientIdMismatch).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to saved result client id when variables are empty", async () => {
    localStorage.setItem(
      "zeninstaller_azure_result",
      JSON.stringify({ clientId: "saved-client", tenantId: "tenant-1", subscriptionIds: ["sub-1"] }),
    );

    let latest: UseAzureAppRegistrationCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ variableValues: {} })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    expect(latest?.spClientId).toBe("saved-client");
    expect(latest?.planClientIdMismatch).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("resets steps and clears persisted result", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
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
      await latest?.run();
    });

    await waitFor(() => {
      expect(latest?.result?.clientId).toBe("existing-app");
      expect((latest?.steps.length ?? 0) > 0).toBe(true);
      expect(localStorage.getItem("zeninstaller_azure_result")).not.toBeNull();
    });

    await act(async () => {
      latest?.reset();
    });

    expect(latest?.result).toBeNull();
    expect(latest?.steps).toEqual([]);
    expect(localStorage.getItem("zeninstaller_azure_result")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("returns early when required run inputs are missing", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null, githubAccount: null, subscriptionId: "" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.run();
    });

    expect(latest?.running).toBe(false);
    expect(latest?.steps).toEqual([]);
    expect(apiMocks.getExistingApp).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses existing app/SP path without creating new resources", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ tenantId: undefined, manualTenantId: "" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.run();
    });

    await waitFor(() => {
      expect(apiMocks.getExistingApp).toHaveBeenCalled();
      expect(apiMocks.createAppRegistration).not.toHaveBeenCalled();
      expect(apiMocks.getExistingSP).toHaveBeenCalled();
      expect(apiMocks.createServicePrincipal).not.toHaveBeenCalled();
      expect(apiMocks.setOidcImmutableSubject).toHaveBeenCalledWith(
        expect.objectContaining({ login: "org-one" }),
        "repo-one",
      );
      expect(apiMocks.ensureFederatedCredential).toHaveBeenCalledTimes(2);
      const subjects = apiMocks.ensureFederatedCredential.mock.calls.map((c) => c[3]);
      expect(subjects).toEqual([
        "repo:org-one@1/repo-one@456789:environment:PROD",
        "repo:org-one@1/repo-one@456789:environment:TEST",
      ]);
      expect(apiMocks.ensureRbacRole).toHaveBeenCalledTimes(1);
      expect(apiMocks.ensureRbacRole).toHaveBeenCalledWith(
        expect.anything(),
        "sub-1",
        "sp-existing",
        "Reader",
        undefined,
      );
      expect(latest?.result?.tenantId).toBe("tenant-home");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("creates app and service principal when they do not exist", async () => {
    apiMocks.getExistingApp.mockResolvedValueOnce(null);
    apiMocks.getExistingSP.mockResolvedValueOnce(null);

    let latest: UseAzureAppRegistrationCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ tenantId: "tenant-2" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await latest?.run();
    });

    await waitFor(() => {
      expect(apiMocks.createAppRegistration).toHaveBeenCalledWith(
        expect.anything(),
        "zeninstaller-github",
        [],
        "tenant-2",
      );
      expect(apiMocks.createServicePrincipal).toHaveBeenCalledWith(expect.anything(), "created-app", "tenant-2");
      expect(latest?.result?.clientId).toBe("created-app");
      expect(latest?.result?.tenantId).toBe("tenant-2");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("asks for every scope up front, one call per resource, before doing any work", async () => {
    let latest: UseAzureAppRegistrationCard | null = null;
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
      await latest?.run();
    });

    await waitFor(() => {
      expect(apiMocks.ensureScopeConsent).toHaveBeenCalledTimes(1);
    });
    // ARM consent is already established by the Azure login card, so only Graph is asked for here.
    expect(apiMocks.ensureScopeConsent.mock.calls[0][1]).toEqual(["app.scope"]);
    // Nothing may run before consent is settled — a redirect here must cost no progress.
    expect(apiMocks.ensureScopeConsent.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getExistingApp.mock.invocationCallOrder[0],
    );
    expect(latest?.steps.find((s) => s.id === "consent")?.status).toBe("skipped");

    await act(async () => {
      root.unmount();
    });
  });

  it("marks the current step with non-consent errors", async () => {
    apiMocks.getExistingApp.mockRejectedValueOnce(new Error("boom"));
    apiMocks.isConsentError.mockReturnValueOnce(false);

    let latest: UseAzureAppRegistrationCard | null = null;
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
      await latest?.run();
    });

    await waitFor(() => {
      expect(latest?.running).toBe(false);
      expect(latest?.steps.find((s) => s.id === "app")?.status).toBe("error");
      expect(latest?.steps.find((s) => s.id === "app")?.detail).toBe("boom");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("attempts consent redirect and keeps consent message when MSAL is unavailable", async () => {
    apiMocks.getExistingApp.mockRejectedValueOnce(new Error("interaction_required"));
    apiMocks.isConsentError.mockReturnValueOnce(true);
    apiMocks.getMsal.mockResolvedValueOnce(null);

    let latest: UseAzureAppRegistrationCard | null = null;
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
      await latest?.run();
    });

    await waitFor(() => {
      expect(latest?.steps.find((s) => s.id === "app")?.detail).toBe(
        "Additional consent required — redirecting to Microsoft...",
      );
      expect(apiMocks.getMsal).toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("reports consent redirect failure when redirect throws", async () => {
    apiMocks.getExistingApp.mockRejectedValueOnce(new Error("AADSTS65001"));
    apiMocks.isConsentError.mockReturnValueOnce(true);
    apiMocks.getMsal.mockResolvedValueOnce({
      acquireTokenRedirect: vi.fn().mockRejectedValue(new Error("redirect failed")),
    });

    let latest: UseAzureAppRegistrationCard | null = null;
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
      await latest?.run();
    });

    await waitFor(() => {
      expect(latest?.steps.find((s) => s.id === "app")?.detail).toBe("Consent redirect failed — try again");
      expect(latest?.running).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });
});
