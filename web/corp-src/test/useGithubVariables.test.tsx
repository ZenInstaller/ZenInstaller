/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubVariables, type UseGithubVariables } from "../hooks/useGithubVariables";
import type { Account } from "../types";

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    fetchVariables: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  fetchVariables: apiMocks.fetchVariables,
}));

function HookHarness(props: { onUpdate: (value: UseGithubVariables) => void } & Parameters<typeof useGithubVariables>[0]) {
  const value = useGithubVariables(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

function baseProps(overrides: Partial<Parameters<typeof useGithubVariables>[0]> = {}): Parameters<typeof useGithubVariables>[0] {
  return {
    account: { login: "org-one", id: 1, type: "Organization" } satisfies Account,
    repoName: "repo-one",
    envName: "prod",
    ...overrides,
  };
}

async function waitFor(assertion: () => void, timeoutMs = 1500) {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}

describe("useGithubVariables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchVariables.mockResolvedValue({ NAME: "Zenblox" });
  });

  it("loads variables for the selected GitHub environment", async () => {
    let latest: UseGithubVariables | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(apiMocks.fetchVariables).toHaveBeenCalledWith({ login: "org-one", id: 1, type: "Organization" }, "repo-one", "prod");
      expect(latest?.values).toEqual({ NAME: "Zenblox" });
      expect(latest?.loading).toBe(false);
      expect(latest?.error).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  // TODO: test each of the three missing pieces (account, repoName, envName) separately
  // Cannot fetch variables until account, repo, and environment are all selected.
  it("onRefresh is a no-op when the GitHub target is incomplete", async () => {
    let latest: UseGithubVariables | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ account: null, repoName: null })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      await latest?.onRefresh();
    });

    expect(apiMocks.fetchVariables).not.toHaveBeenCalled();
    expect(latest?.values).toEqual({});
    expect(latest?.refreshing).toBe(false);
    expect(latest?.error).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("onRefresh sets error when variable loading throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.fetchVariables.mockResolvedValueOnce({ NAME: "Zenblox" }).mockRejectedValueOnce(new Error("var load failed"));

    let latest: UseGithubVariables | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.values).toEqual({ NAME: "Zenblox" });
    });

    await act(async () => {
      await latest?.onRefresh();
    });

    await waitFor(() => {
      expect(latest?.refreshing).toBe(false);
      expect(latest?.error).toBe(true);
      expect(consoleError).toHaveBeenCalled();
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("onConfirmed merges saved variable values", async () => {
    let latest: UseGithubVariables | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps()}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.values).toEqual({ NAME: "Zenblox" });
    });

    await act(async () => {
      latest?.onConfirmed("AZURE_CLIENT_ID", "client-1");
      latest?.onConfirmed("AZURE_TENANT_ID", "tenant-1");
    });

    expect(latest?.values).toMatchObject({
      NAME: "Zenblox",
      AZURE_CLIENT_ID: "client-1",
      AZURE_TENANT_ID: "tenant-1",
    });

    await act(async () => {
      root.unmount();
    });
  });
});
