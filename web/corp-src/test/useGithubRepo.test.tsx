/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useGithubRepo, type UseGithubRepo } from "../cards/Repo/useGithubRepo";
import type { Account, Branch, RepoOption, User } from "../types";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    fetchOrgList: vi.fn(),
    fetchRepos: vi.fn(),
    checkTemplate: vi.fn(),
    fetchBranches: vi.fn(),
    generateRepo: vi.fn(),
    createBranch: vi.fn(),
  },
}));

const { urlMocks } = vi.hoisted(() => ({
  urlMocks: {
    has: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  default: {
    fetchOrgList: mockApi.fetchOrgList,
    fetchRepos: mockApi.fetchRepos,
    checkTemplate: mockApi.checkTemplate,
    fetchBranches: mockApi.fetchBranches,
    generateRepo: mockApi.generateRepo,
    createBranch: mockApi.createBranch,
  },
  fetchOrgList: mockApi.fetchOrgList,
  fetchRepos: mockApi.fetchRepos,
  checkTemplate: mockApi.checkTemplate,
  fetchBranches: mockApi.fetchBranches,
  generateRepo: mockApi.generateRepo,
  createBranch: mockApi.createBranch,
}));

vi.mock("../hooks/useUrlStateManager", () => ({
  INITIAL_URL_PARAMS: {
    has: urlMocks.has,
  },
}));

function HookHarness(props: { user: Parameters<typeof useGithubRepo>[0]; onUpdate: (value: UseGithubRepo) => void }) {
  const value = useGithubRepo(props.user);

  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);

  return null;
}

function baseUser(): User {
  return { login: "jake" };
}

async function waitFor(assertion: () => void, timeoutMs = 1500) {
  const start = Date.now();
  while (true) {
    let passed = false;
    let lastError: unknown;

    await act(async () => {
      try {
        assertion();
        passed = true;
      } catch (error) {
        lastError = error;
      }
    });

    if (passed) return;
    if (Date.now() - start > timeoutMs) throw lastError;

    // Let queued async updates settle before retrying.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("useGithubRepo", () => {
  const accountOne: Account = { login: "org-one", type: "Organization", id: 101 };
  const accountTwo: Account = { login: "org-two", type: "Organization", id: 102 };

  beforeEach(() => {
    vi.clearAllMocks();
    urlMocks.has.mockReturnValue(false);
    mockApi.fetchOrgList.mockResolvedValue([accountOne, accountTwo]);
    mockApi.fetchRepos.mockImplementation(async (account: Account) => {
      if (account.login === "org-two") return [{ id: 2, name: "repo-b" }];
      return [{ id: 1, name: "repo-a" }];
    });
    mockApi.checkTemplate.mockResolvedValue({ templateName: "" });
    mockApi.fetchBranches.mockResolvedValue([]);
    mockApi.generateRepo.mockResolvedValue({
      repo: { id: 33, name: "new-repo" },
      envSuccess: true,
      results: { envs: [] },
    });
    mockApi.createBranch.mockResolvedValue({ name: "feature/test", commit: "abc", protected: false });
  });

  it("loads accounts and selects the first account by default", async () => {
    let latest: UseGithubRepo | null = null;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.selectedAccount?.login).toBe("org-one");
      expect(latest?.accountList).toHaveLength(2);
    });

    await waitFor(() => {
      expect(mockApi.fetchRepos).toHaveBeenCalledWith(accountOne);
      expect(latest?.repoList.map((r) => r.name)).toEqual(["repo-a"]);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not auto-select an account when URL has account param", async () => {
    let latest: UseGithubRepo | null = null;
    const container = document.createElement("div");
    const root = createRoot(container);
    urlMocks.has.mockImplementation((key: string) => key === "account");

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.accountList).toHaveLength(2);
      expect(latest?.selectedAccount).toBeNull();
      expect(latest?.restore.account.ready).toBe(true);
      expect(latest?.restore.account.scope).toBe("jake");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("computes repoFullName only for existing selected repo", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.selectedAccount?.login).toBe("org-one");
      expect(latest?.repoList).toHaveLength(1);
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: 1, name: "repo-a" });
    });

    await waitFor(() => {
      expect(latest?.repoFullName).toBe("org-one/repo-a");
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: "new-repo", name: "new-repo", isNew: true });
    });

    expect(latest?.repoFullName).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("checks template and loads branches with main priority", async () => {
    const branches: Branch[] = [
      { name: "feature", commit: "aaa", protected: false },
      { name: "main", commit: "bbb", protected: true },
    ];
    mockApi.checkTemplate.mockResolvedValue({ templateName: "ZenMe-AU/ZenbloxCore" });
    mockApi.fetchBranches.mockResolvedValue(branches);

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.repoList).toHaveLength(1);
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: 1, name: "repo-a" });
    });

    await waitFor(() => {
      expect(mockApi.checkTemplate).toHaveBeenCalledWith(accountOne, "repo-a");
      expect(latest?.templateStatus).toBe("ready");
      expect(latest?.status).toBe("complete");
      expect(latest?.sourceBranch).toBe("main");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to first branch when main is absent and handles loadBranches errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.checkTemplate.mockResolvedValue({ templateName: "ZenMe-AU/ZenbloxCore" });
    mockApi.fetchBranches.mockResolvedValueOnce([{ name: "dev", commit: "abc", protected: false }]);

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.repoList).toHaveLength(1);
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: 1, name: "repo-a" });
    });

    await waitFor(() => {
      expect(latest?.sourceBranch).toBe("dev");
    });

    mockApi.fetchBranches.mockRejectedValueOnce(new Error("branch fail"));
    await act(async () => {
      latest?.setSelectedRepo({ id: 2, name: "repo-b" });
    });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("Failed to fetch branches:", expect.any(Error));
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("sets warning when selected repo is not from expected template or template check fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.checkTemplate.mockResolvedValueOnce({ templateName: "other/template" });

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.repoList).toHaveLength(1);
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: 1, name: "repo-a" });
    });

    await waitFor(() => {
      expect(latest?.templateStatus).toBe("not_clone");
      expect(latest?.status).toBe("warning");
    });

    mockApi.checkTemplate.mockRejectedValueOnce(new Error("template fail"));
    await act(async () => {
      latest?.setSelectedRepo({ id: 2, name: "repo-b" });
    });

    await waitFor(() => {
      expect(latest?.templateStatus).toBe("not_clone");
      expect(latest?.status).toBe("warning");
      expect(consoleError).toHaveBeenCalledWith("Failed to check template:", expect.any(Error));
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("uses repo cache when switching back to a previously loaded account", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(mockApi.fetchRepos).toHaveBeenCalledTimes(1);
      expect(latest?.selectedAccount?.login).toBe("org-one");
    });

    await act(async () => {
      latest?.setSelectedAccount(accountTwo);
    });

    await waitFor(() => {
      expect(mockApi.fetchRepos).toHaveBeenCalledTimes(2);
      expect(latest?.repoList.map((r) => r.name)).toEqual(["repo-b"]);
    });

    await act(async () => {
      latest?.setSelectedAccount(accountOne);
    });

    await waitFor(() => {
      expect(mockApi.fetchRepos).toHaveBeenCalledTimes(2);
      expect(latest?.repoList.map((r) => r.name)).toEqual(["repo-a"]);
      expect(latest?.restore.repo.ready).toBe(true);
      expect(latest?.restore.repo.scope).toBe(101);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("handles repo fetch failures and still marks repos loaded", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockApi.fetchRepos.mockRejectedValueOnce(new Error("repos fail"));

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.repoList).toEqual([]);
      expect(latest?.restore.repo.ready).toBe(true);
      expect(consoleError).toHaveBeenCalled();
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("prevents cloning when the target repository already exists", async () => {
    let latest: UseGithubRepo | null = null;
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.repoList.some((r) => r.name === "repo-a")).toBe(true);
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: "repo-a", name: "repo-a", isNew: true });
    });

    await waitFor(() => {
      expect(latest?.selectedRepo?.name).toBe("repo-a");
    });

    await act(async () => {
      await latest?.onClone();
    });

    expect(latest?.cloneError).toBe('Repository "repo-a" already exists');
    expect(mockApi.generateRepo).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("returns early from clone when account or repo is missing", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedAccount(null);
      latest?.setSelectedRepo(null);
    });

    await act(async () => {
      await latest?.onClone();
    });

    expect(mockApi.generateRepo).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("clones repo successfully and sets environment warning on partial env creation", async () => {
    mockApi.generateRepo.mockResolvedValueOnce({
      repo: { id: 33, name: "new-repo" },
      envSuccess: false,
      results: {
        envs: [
          { name: "PROD", success: false },
          { name: "TEST", success: true },
        ],
      },
    });

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.selectedAccount).not.toBeNull();
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: "new-repo", name: "new-repo", isNew: true });
    });

    await act(async () => {
      await latest?.onClone();
    });

    await waitFor(() => {
      expect(mockApi.generateRepo).toHaveBeenCalled();
      expect(latest?.cloneEnvWarning).toContain("failed to create environments: PROD");
      expect(latest?.selectedRepo?.name).toBe("new-repo");
      expect(latest?.cloning).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sets clone error when clone generation fails", async () => {
    mockApi.generateRepo.mockRejectedValueOnce(new Error("clone failed"));

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.selectedAccount).not.toBeNull();
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: "new-repo", name: "new-repo", isNew: true });
    });

    await act(async () => {
      await latest?.onClone();
    });

    expect(latest?.cloneError).toBe("Clone failed");
    expect(latest?.cloning).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("refreshes orgs and repos, and reports refresh failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.selectedAccount?.login).toBe("org-one");
    });

    await act(async () => {
      latest?.onRefresh();
    });

    await waitFor(() => {
      expect(latest?.repoLoading).toBe(false);
      expect(latest?.repoRefreshFailed).toBe(false);
      expect(mockApi.fetchOrgList).toHaveBeenCalled();
    });

    mockApi.fetchOrgList.mockRejectedValueOnce(new Error("refresh fail"));
    await act(async () => {
      latest?.onRefresh();
    });

    await waitFor(() => {
      expect(latest?.repoLoading).toBe(false);
      expect(latest?.repoRefreshFailed).toBe(true);
      expect(consoleError).toHaveBeenCalled();
    });

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("returns early from refresh when account ref is missing", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedAccount(null);
    });

    mockApi.fetchOrgList.mockClear();
    mockApi.fetchRepos.mockClear();

    await act(async () => {
      latest?.onRefresh();
    });

    expect(mockApi.fetchOrgList).not.toHaveBeenCalled();
    expect(mockApi.fetchRepos).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("creates a branch successfully and reports create-branch failure", async () => {
    mockApi.checkTemplate.mockResolvedValue({ templateName: "ZenMe-AU/ZenbloxCore" });
    mockApi.fetchBranches.mockResolvedValue([{ name: "main", commit: "a", protected: true }]);

    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedRepo({ id: 1, name: "repo-a" });
    });

    await waitFor(() => {
      expect(latest?.branchList.some((b) => b.name === "main")).toBe(true);
    });

    await act(async () => {
      await latest?.onCreateBranch("feature/test");
    });

    await waitFor(() => {
      expect(latest?.branchList.some((b) => b.name === "feature/test")).toBe(true);
      expect(latest?.creatingBranch).toBe(false);
      expect(latest?.createBranchError).toBeNull();
    });

    mockApi.createBranch.mockRejectedValueOnce(new Error("branch fail"));
    await act(async () => {
      await latest?.onCreateBranch("feature/fail");
    });

    expect(latest?.createBranchError).toBe("Failed to create branch");
    expect(latest?.creatingBranch).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("returns early from onCreateBranch when account or repo is missing", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSelectedAccount(null);
      latest?.setSelectedRepo(null);
    });

    mockApi.createBranch.mockClear();
    await act(async () => {
      await latest?.onCreateBranch("feature/noop");
    });

    expect(mockApi.createBranch).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("restoreAccount and restoreRepo handle match/miss branches", async () => {
    let latest: UseGithubRepo | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          user={baseUser()}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.accountList).toHaveLength(2);
      expect(latest?.repoList).toHaveLength(1);
      expect(latest?.restore.account.ready).toBe(true);
      expect(latest?.restore.repo.ready).toBe(true);
    });

    await act(async () => {
      expect(latest?.restore.account.apply("org-two")).toBe(true);
    });

    await waitFor(() => {
      expect(latest?.selectedAccount?.login).toBe("org-two");
    });

    await act(async () => {
      expect(latest?.restore.account.apply("missing-account")).toBe(false);
    });

    await waitFor(() => {
      expect(latest?.selectedAccount?.login).toBe("org-one");
    });

    await act(async () => {
      expect(latest?.restore.repo.apply("repo-a")).toBe(true);
      expect(latest?.restore.repo.apply("missing-repo")).toBe(false);
    });

    expect(latest?.selectedRepo?.name).toBe("repo-a");

    await act(async () => {
      root.unmount();
    });
  });
});
