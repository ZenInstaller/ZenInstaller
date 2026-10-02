import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateDomainCard, type UseCreateDomainCard } from "../cards/CreateDomain/useCreateDomainCard";
import type { AzureAccount } from "../types";

async function waitFor(assertion: () => void, timeoutMs = 2000) {
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
    getProviderRegistrationState: vi.fn(),
    registerProvider: vi.fn(),
    ensureDnsZone: vi.fn(),
    ensureDnsTxtRecord: vi.fn(),
    getEntraDomain: vi.fn(),
    createEntraDomain: vi.fn(),
    getDomainVerificationTxt: vi.fn(),
    verifyEntraDomain: vi.fn(),
    setPrimaryEntraDomain: vi.fn(),
    listVerifiedDomains: vi.fn().mockResolvedValue([]),
    getExistingSP: vi.fn(),
    grantAdminConsent: vi.fn(),
    isConsentError: vi.fn(),
  },
}));

const { configMocks } = vi.hoisted(() => ({
  configMocks: {
    azureClientId: "client-id",
  },
}));

vi.mock("../auth/msal", () => ({
  getMsal: apiMocks.getMsal,
  ensureScopeConsent: apiMocks.ensureScopeConsent,
}));

vi.mock("../api/azureArm", () => ({
  getProviderRegistrationState: apiMocks.getProviderRegistrationState,
  registerProvider: apiMocks.registerProvider,
  ensureDnsZone: apiMocks.ensureDnsZone,
  ensureDnsTxtRecord: apiMocks.ensureDnsTxtRecord,
}));

vi.mock("../api/azureGraph", () => ({
  getEntraDomain: apiMocks.getEntraDomain,
  createEntraDomain: apiMocks.createEntraDomain,
  getDomainVerificationTxt: apiMocks.getDomainVerificationTxt,
  verifyEntraDomain: apiMocks.verifyEntraDomain,
  setPrimaryEntraDomain: apiMocks.setPrimaryEntraDomain,
  listVerifiedDomains: apiMocks.listVerifiedDomains,
  getExistingSP: apiMocks.getExistingSP,
  grantAdminConsent: apiMocks.grantAdminConsent,
}));

vi.mock("../logic/consent", () => ({
  isConsentError: apiMocks.isConsentError,
}));

vi.mock("../config/azureConfig", () => ({
  get AZURE_CLIENT_ID() {
    return configMocks.azureClientId;
  },
  DNS_PROVIDERS: ["Microsoft.Network"],
  ARM_SCOPES: ["arm.scope"],
  APP_SCOPES: ["app.scope"],
  DOMAIN_SCOPES: ["domain.scope"],
  GRANT_CONSENT_SCOPES: ["grant.scope"],
  GRAPH_PERMISSIONS: {
    DomainReadWriteAll: "Domain.ReadWrite.All",
  },
}));

function HookHarness(
  props: {
    onUpdate: (value: UseCreateDomainCard) => void;
  } & Parameters<typeof useCreateDomainCard>[0],
) {
  const value = useCreateDomainCard(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

function baseProps(
  overrides: Partial<Parameters<typeof useCreateDomainCard>[0]> = {},
): Parameters<typeof useCreateDomainCard>[0] {
  return {
    azureAccount: { tenantId: "tenant-1" } as AzureAccount,
    subscriptionId: "sub-1",
    corpName: "Zenblox",
    dnsName: "zenblox.io",
    spClientId: "client-a",
    tenantId: "tenant-1",
    ...overrides,
  };
}

describe("useCreateDomainCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    configMocks.azureClientId = "client-id";

    apiMocks.getMsal.mockResolvedValue({
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    });
    apiMocks.ensureScopeConsent.mockResolvedValue(false);
    apiMocks.getProviderRegistrationState.mockResolvedValue("Registered");
    apiMocks.ensureDnsZone.mockResolvedValue({ result: "created", nameServers: ["ns1", "ns2"] });
    apiMocks.ensureDnsTxtRecord.mockResolvedValue("created");
    apiMocks.getEntraDomain.mockResolvedValue(null);
    apiMocks.createEntraDomain.mockResolvedValue({ isVerified: false, isDefault: false });
    apiMocks.getDomainVerificationTxt.mockResolvedValue("txt-token");
    apiMocks.verifyEntraDomain.mockResolvedValue({ isVerified: true, isDefault: false });
    apiMocks.setPrimaryEntraDomain.mockResolvedValue(undefined);
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-1" });
    apiMocks.grantAdminConsent.mockResolvedValue(undefined);
    apiMocks.isConsentError.mockReturnValue(false);
  });

  it("computes resourcesDone from resultMatches and drops stale persisted state", async () => {
    localStorage.setItem(
      "zeninstaller_create_domain_result",
      JSON.stringify({
        corpName: "Zenblox",
        dnsName: "zenblox.io",
        subscriptionId: "sub-1",
        nameServers: ["old-ns"],
        domainVerified: true,
        isPrimary: true,
      }),
    );

    let latest: UseCreateDomainCard | null = null;
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

    expect(latest?.resourcesDone).toBe(true);
    expect(latest?.done).toBe(true);

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ dnsName: "new.zenblox.io" })}
          onUpdate={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(latest?.resourcesDone).toBe(false);
      expect(latest?.nameServers).toEqual([]);
      expect(latest?.domainVerified).toBe(false);
      expect(latest?.isPrimary).toBe(false);
      expect(latest?.steps).toEqual([]);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("suppresses check-status consent errors but surfaces non-consent errors", async () => {
    apiMocks.getEntraDomain.mockRejectedValueOnce(new Error("AADSTS65001"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("AADSTS65001"));

    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.checkingStatus).toBe(false);
      expect(latest?.checkStatusError).toBeNull();
    });

    apiMocks.getEntraDomain.mockRejectedValueOnce(new Error("network down"));
    apiMocks.isConsentError.mockReturnValue(false);
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

    await waitFor(() => {
      expect(latest?.checkingStatus).toBe(false);
      expect(latest?.checkStatusError).toBe("network down");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("returns early from run when required inputs are missing", async () => {
    let latest: UseCreateDomainCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ azureAccount: null, subscriptionId: "", corpName: "", dnsName: "" })}
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
    expect(apiMocks.ensureDnsZone).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("runs full setup and creates domain/txt/grant when needed", async () => {
    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "dns")?.status).toBe("done");
      expect(latest?.steps.find((s) => s.id === "domain")?.status).toBe("done");
      expect(latest?.steps.find((s) => s.id === "txt")?.status).toBe("done");
      expect(latest?.steps.find((s) => s.id === "primary")?.status).toBe("skipped");
      expect(latest?.steps.find((s) => s.id === "grant")?.status).toBe("done");
      expect(apiMocks.createEntraDomain).toHaveBeenCalled();
      expect(apiMocks.ensureDnsTxtRecord).toHaveBeenCalled();
      expect(apiMocks.grantAdminConsent).toHaveBeenCalled();
      expect(latest?.nameServers).toEqual(["ns1", "ns2"]);
      expect(localStorage.getItem("zeninstaller_create_domain_result")).not.toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("uses existing verified primary domain path with skipped txt/primary", async () => {
    apiMocks.getEntraDomain.mockResolvedValue({ isVerified: true, isDefault: true });
    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "domain")?.status).toBe("skipped");
      expect(latest?.steps.find((s) => s.id === "txt")?.detail).toBe("Domain already verified");
      expect(latest?.steps.find((s) => s.id === "primary")?.detail).toBe("Already the primary domain");
      expect(latest?.isPrimary).toBe(true);
      expect(apiMocks.setPrimaryEntraDomain).not.toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sets primary when domain is verified but not default", async () => {
    apiMocks.getEntraDomain.mockResolvedValue({ isVerified: true, isDefault: false });
    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "primary")?.status).toBe("done");
      expect(apiMocks.setPrimaryEntraDomain).toHaveBeenCalled();
      expect(latest?.isPrimary).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("skips grant step when there is no app registration client id", async () => {
    let latest: UseCreateDomainCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ spClientId: "" })}
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
      expect(latest?.steps.find((s) => s.id === "grant")?.status).toBe("skipped");
      expect(latest?.steps.find((s) => s.id === "grant")?.detail).toBe("No app registration client id yet");
      expect(apiMocks.grantAdminConsent).not.toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("asks for every scope up front, one call per resource, before doing any work", async () => {
    let latest: UseCreateDomainCard | null = null;
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
    expect(apiMocks.ensureScopeConsent.mock.calls[0][1]).toEqual(["domain.scope", "grant.scope", "app.scope"]);
    // Nothing may run before consent is settled — a redirect here must cost no progress.
    expect(apiMocks.ensureScopeConsent.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getProviderRegistrationState.mock.invocationCallOrder[0],
    );
    expect(latest?.steps.find((s) => s.id === "consent")?.status).toBe("skipped");

    await act(async () => {
      root.unmount();
    });
  });

  it("fails run when TXT token is missing", async () => {
    apiMocks.getDomainVerificationTxt.mockResolvedValueOnce("");
    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "txt")?.status).toBe("error");
      expect(latest?.steps.find((s) => s.id === "txt")?.detail).toBe(
        "No TXT verification record returned by Microsoft Graph",
      );
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes consent errors in run to domain consent and handles redirect failure", async () => {
    apiMocks.createEntraDomain.mockRejectedValueOnce(new Error("AADSTS65001"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("AADSTS65001"));
    apiMocks.getMsal.mockResolvedValueOnce({
      acquireTokenRedirect: vi.fn().mockRejectedValue(new Error("redirect failed")),
    });

    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "domain")?.detail).toBe("Consent redirect failed — try again");
      expect(apiMocks.getMsal).toHaveBeenCalled();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes grant-step consent errors to grant consent redirect", async () => {
    apiMocks.grantAdminConsent.mockRejectedValueOnce(new Error("AADSTS65001"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("AADSTS65001"));
    const acquireTokenRedirect = vi.fn().mockResolvedValue(undefined);
    apiMocks.getMsal.mockResolvedValue({ acquireTokenRedirect });

    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.steps.find((s) => s.id === "grant")?.detail).toBe(
        "Additional consent required — redirecting to Microsoft...",
      );
      expect(acquireTokenRedirect).toHaveBeenCalledWith({
        scopes: ["grant.scope"],
        account: expect.anything(),
        authority: "https://login.microsoftonline.com/tenant-1",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("verify returns early when prerequisites are missing", async () => {
    let latest: UseCreateDomainCard | null = null;
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

    await act(async () => {
      await latest?.verify();
    });

    expect(latest?.verifying).toBe(false);
    expect(apiMocks.verifyEntraDomain).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("verify sets propagation message when domain is still unverified", async () => {
    apiMocks.verifyEntraDomain.mockResolvedValueOnce({ isVerified: false, isDefault: false });
    let latest: UseCreateDomainCard | null = null;
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
      await latest?.verify();
    });

    await waitFor(() => {
      expect(latest?.verifyError).toBe(
        "Verification did not complete — DNS may still be propagating. Try again shortly.",
      );
      expect(latest?.isPrimary).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("verify sets primary and persists updated result when verification succeeds", async () => {
    let latest: UseCreateDomainCard | null = null;
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

    apiMocks.verifyEntraDomain.mockResolvedValueOnce({ isVerified: true, isDefault: false });
    await act(async () => {
      await latest?.verify();
    });

    await waitFor(() => {
      expect(apiMocks.setPrimaryEntraDomain).toHaveBeenCalled();
      expect(latest?.domainVerified).toBe(true);
      expect(latest?.isPrimary).toBe(true);
      expect(latest?.verifyError).toBeNull();
      expect(localStorage.getItem("zeninstaller_create_domain_result")).not.toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("verify reports primary-set failure", async () => {
    apiMocks.verifyEntraDomain.mockResolvedValueOnce({ isVerified: true, isDefault: false });
    apiMocks.setPrimaryEntraDomain.mockRejectedValueOnce(new Error("set primary blocked"));
    let latest: UseCreateDomainCard | null = null;
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
      await latest?.verify();
    });

    await waitFor(() => {
      expect(latest?.verifyError).toBe("Domain verified, but setting it as primary failed: set primary blocked");
      expect(latest?.isPrimary).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("verify maps consent and non-consent failures to different user messages", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apiMocks.verifyEntraDomain.mockRejectedValueOnce(new Error("AADSTS65001"));
    apiMocks.isConsentError.mockImplementation((msg: string) => msg.includes("AADSTS65001"));

    let latest: UseCreateDomainCard | null = null;
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
      await latest?.verify();
    });

    await waitFor(() => {
      expect(latest?.verifyError).toBe("Additional consent required — run the setup once to grant it.");
    });

    apiMocks.verifyEntraDomain.mockRejectedValueOnce(new Error("network down"));
    apiMocks.isConsentError.mockReturnValue(false);
    await act(async () => {
      await latest?.verify();
    });

    await waitFor(() => {
      expect(latest?.verifyError).toBe(
        "Verification failed — make sure your registrar's NS records point to the Azure DNS name servers, then retry after DNS propagates.",
      );
      expect(consoleWarn).toHaveBeenCalled();
    });

    consoleWarn.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("reset clears volatile state and persisted result", async () => {
    let latest: UseCreateDomainCard | null = null;
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
      expect(localStorage.getItem("zeninstaller_create_domain_result")).not.toBeNull();
    });

    await act(async () => {
      latest?.reset();
    });

    expect(latest?.steps).toEqual([]);
    expect(latest?.nameServers).toEqual([]);
    expect(latest?.domainVerified).toBe(false);
    expect(latest?.isPrimary).toBe(false);
    expect(latest?.verifyError).toBeNull();
    expect(localStorage.getItem("zeninstaller_create_domain_result")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("computes warning/complete/error status and summary", async () => {
    let latest: UseCreateDomainCard | null = null;
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
      expect(latest?.summary).toBe("Set up the corp domain");
    });

    apiMocks.getEntraDomain.mockResolvedValueOnce({ isVerified: true, isDefault: true });
    await act(async () => {
      await latest?.run();
    });

    await waitFor(() => {
      expect(latest?.status).toBe("complete");
      expect(latest?.summary).toBe("Domain verified and primary");
    });

    configMocks.azureClientId = "";
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

    await waitFor(() => {
      expect(latest?.status).toBe("error");
      expect(latest?.summary).toBe("Unavailable");
    });

    await act(async () => {
      root.unmount();
    });
  });
});
