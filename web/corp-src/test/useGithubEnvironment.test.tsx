/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGithubEnvironment, type UseGithubEnvironment } from "../cards/Repo/useGithubEnvironment";
import type { Account, Branch, GhEnv, RepoOption } from "../types";

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    fetchEnvs: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  fetchEnvs: apiMocks.fetchEnvs,
}));

function HookHarness(props: { onUpdate: (value: UseGithubEnvironment) => void } & Parameters<typeof useGithubEnvironment>[0]) {
  const value = useGithubEnvironment(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

function baseProps(overrides: Partial<Parameters<typeof useGithubEnvironment>[0]> = {}): Parameters<typeof useGithubEnvironment>[0] {
  return {
    account: { login: "org-one", id: 1, type: "Organization" } satisfies Account,
    repo: { id: 11, name: "repo-one" } satisfies RepoOption,
    branches: [{ name: "prod", commit: "sha", protected: false } satisfies Branch],
    isRepoReady: true,
    ...overrides,
  };
}

function env(name = "prod"): GhEnv {
  return { id: 1, name, url: "https://example.com" };
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

describe("useGithubEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchEnvs.mockResolvedValue([env()]);
  });

  it("loads environments, matches the selected branch, and restores by name", async () => {
    let latest: UseGithubEnvironment | null = null;
    const root = createRoot(document.createElement("div"));

    act(() => {
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
      expect(apiMocks.fetchEnvs).toHaveBeenCalledWith({ login: "org-one", id: 1, type: "Organization" }, "repo-one");
      expect(latest?.envList).toHaveLength(1);
    });

    await act(async () => {
      latest?.setSelectedEnv(latest.envList[0]);
    });

    await waitFor(() => {
      expect(latest?.status).toBe("complete");
      expect(latest?.branchMatchWarning).toBeNull();
    });

    await act(async () => {
      expect(latest?.restore.env.apply("prod")).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("resets environment state when repo id changes", async () => {
    apiMocks.fetchEnvs.mockResolvedValueOnce([env("prod")]).mockImplementationOnce(() => new Promise(() => {}));

    let latest: UseGithubEnvironment | null = null;
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
      expect(latest?.envList).toHaveLength(1);
      expect(latest?.restore.env.ready).toBe(true);
    });

    await act(async () => {
      latest?.setSelectedEnv(env("prod"));
    });

    await waitFor(() => {
      expect(latest?.status).toBe("complete");
    });

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ repo: { id: 22, name: "repo-two" } })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.envList).toEqual([]);
      expect(latest?.selectedEnv).toBeNull();
      expect(latest?.branchMatchWarning).toBeNull();
      expect(latest?.branchMatchError).toBeNull();
      expect(latest?.status).toBe("idle");
      expect(latest?.restore.env.ready).toBe(false);
      expect(latest?.restore.env.scope).toBe(22);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sets envRefreshFailed when loading environments fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.fetchEnvs.mockRejectedValueOnce(new Error("env load failed"));

    let latest: UseGithubEnvironment | null = null;
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
      expect(latest?.envRefreshFailed).toBe(true);
      expect(latest?.envLoading).toBe(false);
      expect(latest?.restore.env.ready).toBe(true);
      expect(consoleError).toHaveBeenCalled();
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("does not load environments when repo is not ready", async () => {
    let latest: UseGithubEnvironment | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ isRepoReady: false })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    expect(apiMocks.fetchEnvs).not.toHaveBeenCalled();
    expect(latest?.restore.env.ready).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("sets warning when environment and branch casing mismatch", async () => {
    let latest: UseGithubEnvironment | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ branches: [{ name: "Prod", commit: "sha", protected: false }] })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedEnv(env("prod"));
    });

    await waitFor(() => {
      expect(latest?.status).toBe("warning");
      expect(latest?.branchMatchWarning).toContain("mismatched casing");
      expect(latest?.branchMatchError).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sets error when multiple branches match selected environment", async () => {
    let latest: UseGithubEnvironment | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({
            branches: [
              { name: "prod", commit: "sha1", protected: false },
              { name: "Prod", commit: "sha2", protected: false },
            ],
          })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedEnv(env("prod"));
    });

    await waitFor(() => {
      expect(latest?.status).toBe("error");
      expect(latest?.branchMatchError).toContain("Multiple branches match environment");
      expect(latest?.branchMatchWarning).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sets error when no branch matches selected environment", async () => {
    let latest: UseGithubEnvironment | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          {...baseProps({ branches: [{ name: "main", commit: "sha", protected: false }] })}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedEnv(env("prod"));
    });

    await waitFor(() => {
      expect(latest?.status).toBe("error");
      expect(latest?.branchMatchError).toContain("No branch found matching environment");
      expect(latest?.branchMatchWarning).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("onRefresh reloads environments using current refs", async () => {
    let latest: UseGithubEnvironment | null = null;
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
      expect(apiMocks.fetchEnvs).toHaveBeenCalledTimes(1);
    });

    apiMocks.fetchEnvs.mockClear();
    await act(async () => {
      latest?.onRefresh();
    });

    await waitFor(() => {
      expect(apiMocks.fetchEnvs).toHaveBeenCalledWith({ login: "org-one", id: 1, type: "Organization" }, "repo-one");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("restore.apply handles unmatched values", async () => {
    let latest: UseGithubEnvironment | null = null;
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
      expect(latest?.restore.env.ready).toBe(true);
      expect(latest?.restore.env.scope).toBe(11);
    });

    await act(async () => {
      expect(latest?.restore.env.apply("missing")).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });
});
