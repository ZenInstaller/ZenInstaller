import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AzureAccount } from "../../types";

const graph = vi.hoisted(() => ({
  getExistingSP: vi.fn(),
  listAppRoleAssignments: vi.fn(),
  grantAdminConsent: vi.fn(),
}));
vi.mock("../../api/azureGraph", () => graph);

const { useAzurePermissions } = await import("../hooks/util/useAzurePermissions");
type Perms = ReturnType<typeof useAzurePermissions>;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
beforeEach(() => {
  vi.clearAllMocks();
  graph.getExistingSP.mockResolvedValue({ id: "sp-1" });
  graph.listAppRoleAssignments.mockResolvedValue([]);
  graph.grantAdminConsent.mockResolvedValue(undefined);
});

// Two hooks side by side, the way two cards each hold their own.
async function mountPair(a: readonly string[], b: readonly string[]) {
  const latest: { a: Perms | null; b: Perms | null } = { a: null, b: null };
  root = createRoot(document.createElement("div"));
  function Harness() {
    const common = { azureAccount: { username: "u" } as AzureAccount, spClientId: "client-1" };
    latest.a = useAzurePermissions({ ...common, permissions: a });
    latest.b = useAzurePermissions({ ...common, permissions: b });
    return null;
  }
  await act(async () => {
    root!.render(React.createElement(Harness));
  });
  return latest;
}

describe("each card grants on its own", () => {
  it("one card granting leaves the other alone", async () => {
    const perms = await mountPair(["perm-a"], ["perm-b"]);
    let release!: () => void;
    graph.getExistingSP.mockImplementation(() => new Promise((r) => (release = () => r({ id: "sp-1" }))));

    let pending!: Promise<void>;
    await act(async () => {
      pending = perms.a!.ensure();
    });

    expect(perms.a!.granting).toBe(true);
    expect(perms.b!.granting).toBe(false); // separate state, not a shared flag

    await act(async () => {
      release();
      await pending;
    });
    expect(perms.a!.granting).toBe(false);
  });

  it("grants only what that card declares, never the union", async () => {
    const perms = await mountPair(["perm-a"], ["perm-b"]);
    await act(async () => {
      await perms.a!.ensure();
    });
    expect(graph.grantAdminConsent).toHaveBeenCalledWith(expect.anything(), "sp-1", ["perm-a"], undefined);
    expect(graph.grantAdminConsent).not.toHaveBeenCalledWith(
      expect.anything(),
      "sp-1",
      expect.arrayContaining(["perm-b"]),
      undefined,
    );
  });

  it("does nothing at all for a card that needs no permissions", async () => {
    const perms = await mountPair([], ["perm-b"]);
    await act(async () => {
      await perms.a!.ensure();
    });
    expect(graph.getExistingSP).not.toHaveBeenCalled();
    expect(perms.a!.granting).toBe(false);
  });

  it("keeps ensure stable across renders when permissions come from the pipeline", async () => {
    // Both hoisted: the callback also depends on the account, so a fresh object each render
    // would churn it regardless of the permissions array.
    const stable: readonly string[] = ["perm-a"];
    const account = { username: "u" } as AzureAccount;
    const seen: (() => Promise<void>)[] = [];
    root = createRoot(document.createElement("div"));
    function Harness({ n }: { n: number }) {
      const p = useAzurePermissions({ azureAccount: account, spClientId: "client-1", permissions: stable });
      seen.push(p.ensure);
      return React.createElement("span", null, n);
    }
    await act(async () => {
      root!.render(React.createElement(Harness, { n: 1 }));
    });
    await act(async () => {
      root!.render(React.createElement(Harness, { n: 2 }));
    });
    // A fresh array each render would rebuild the callback every time.
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });
});
