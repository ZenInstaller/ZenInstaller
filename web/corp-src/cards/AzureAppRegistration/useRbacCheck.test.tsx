/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountInfo } from "@azure/msal-browser";
import { useRbacCheck, type RbacCheckResult } from "./useRbacCheck";

const azureAccount = {
  homeAccountId: "home-1",
  environment: "login.microsoftonline.com",
  tenantId: "tenant-1",
  username: "org-one",
  localAccountId: "local-1",
} as AccountInfo;

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getExistingSP: vi.fn(),
    hasRbacRole: vi.fn(),
  },
}));

vi.mock("../../api/azureGraph", () => ({
  getExistingSP: apiMocks.getExistingSP,
  hasRbacRole: apiMocks.hasRbacRole,
}));

function HookHarness(props: {
  onUpdate: (value: RbacCheckResult) => void;
  azureAccount: AccountInfo | null;
  spClientId: string;
  subscriptionId: string;
  tenantId?: string;
}) {
  const value = useRbacCheck(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

describe("useRbacCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports ready when the service principal has the role", async () => {
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-1" });
    apiMocks.hasRbacRole.mockResolvedValue(true);

    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId="client-1"
          subscriptionId="sub-1"
          tenantId="tenant-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "ready", missingRoles: [] });

    await act(async () => {
      root.unmount();
    });
  });

  it("reports Reader missing when it has not been assigned", async () => {
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-1" });
    apiMocks.hasRbacRole.mockImplementation(async (_acc: unknown, _sub: string, _sp: string, role: string) => role !== "Reader");

    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId="client-1"
          subscriptionId="sub-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "missing-role", missingRoles: ["Reader"] });

    await act(async () => {
      root.unmount();
    });
  });

  it("asks for Reader and nothing more — the pipeline identity only plans", async () => {
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-1" });
    apiMocks.hasRbacRole.mockResolvedValue(true);

    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<HookHarness onUpdate={() => {}} azureAccount={azureAccount} spClientId="client-1" subscriptionId="sub-1" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const rolesAsked = apiMocks.hasRbacRole.mock.calls.map((c) => c[3]);
    expect(rolesAsked).toEqual(["Reader"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("reports sp-not-found when the service principal does not exist", async () => {
    apiMocks.getExistingSP.mockResolvedValue(null);

    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId="client-1"
          subscriptionId="sub-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "sp-not-found", missingRoles: [] });
    expect(apiMocks.hasRbacRole).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("stays unknown and skips the check when azureAccount is missing", async () => {
    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={null}
          spClientId="client-1"
          subscriptionId="sub-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "unknown", missingRoles: [] });
    expect(apiMocks.getExistingSP).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("stays unknown and skips the check when spClientId is empty", async () => {
    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId=""
          subscriptionId="sub-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "unknown", missingRoles: [] });
    expect(apiMocks.getExistingSP).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("stays unknown and skips the check when subscriptionId is empty", async () => {
    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId="client-1"
          subscriptionId=""
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "unknown", missingRoles: [] });
    expect(apiMocks.getExistingSP).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("stays unknown when the check throws (e.g. a consent/token error)", async () => {
    apiMocks.getExistingSP.mockRejectedValue(new Error("consent_required"));

    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          azureAccount={azureAccount}
          spClientId="client-1"
          subscriptionId="sub-1"
        />
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(latest).toEqual({ status: "unknown", missingRoles: [] });

    await act(async () => {
      root.unmount();
    });
  });

  it("discards a stale result when the target changes before the check resolves", async () => {
    let resolveFirst!: (sp: { id: string } | null) => void;
    apiMocks.getExistingSP.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    let latest: RbacCheckResult | null = null;
    const root = createRoot(document.createElement("div"));
    const render = (subscriptionId: string) =>
      act(async () => {
        root.render(
          <HookHarness
            onUpdate={(value) => {
              latest = value;
            }}
            azureAccount={azureAccount}
            spClientId="client-1"
            subscriptionId={subscriptionId}
          />
        );
      });

    await render("sub-1");

    // Change the target before the in-flight check for sub-1 resolves.
    apiMocks.getExistingSP.mockResolvedValue({ id: "sp-2" });
    apiMocks.hasRbacRole.mockResolvedValue(true);
    await render("sub-2");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(latest).toEqual({ status: "ready", missingRoles: [] });

    // The stale sub-1 lookup resolving afterwards must not overwrite the sub-2 result.
    await act(async () => {
      resolveFirst({ id: "sp-1" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(latest).toEqual({ status: "ready", missingRoles: [] });

    await act(async () => {
      root.unmount();
    });
  });
});
