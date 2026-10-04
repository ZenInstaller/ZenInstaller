/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useGithubLoadable } from "../../hooks/util/useGithubLoadable";
import type { UseGithubLoadable, UseGithubLoadableParams } from "../../hooks/util/useGithubLoadable";
import type { Account } from "../../types";

function HookHarness<T>(props: { params: UseGithubLoadableParams<T>; onUpdate: (value: UseGithubLoadable<T>) => void }) {
  const value = useGithubLoadable(props.params);

  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);

  return null;
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

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function renderHook<T>(params: UseGithubLoadableParams<T>) {
  let latest: UseGithubLoadable<T> | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);

  function rerender(nextParams: UseGithubLoadableParams<T>) {
    act(() => {
      root.render(
        <HookHarness
          params={nextParams}
          onUpdate={(v) => {
            latest = v;
          }}
        />
      );
    });
  }

  rerender(params);

  return {
    get current(): UseGithubLoadable<T> {
      if (!latest) throw new Error("Hook result not ready");
      return latest;
    },
    rerender,
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useGithubLoadable", () => {
  const account: Account = { login: "org-one", type: "Organization", id: 101 };
  const fetcher = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetcher.mockResolvedValue({ NAME: "Zenblox" });
  });

  it("does not fetch when account, repoName, or envName is missing", async () => {
    const harness = renderHook<Record<string, string>>({
      account: null,
      repoName: null,
      envName: null,
      emptyValue: {},
      fetcher,
    });

    await waitFor(() => expect(harness.current.loading).toBe(false));

    expect(fetcher).not.toHaveBeenCalled();
    expect(harness.current.value).toEqual({});
    expect(harness.current.error).toBe(false);

    harness.unmount();
  });

  it("loads the value once account, repoName, and envName are all present", async () => {
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });

    await waitFor(() => expect(harness.current.loading).toBe(false));

    expect(fetcher).toHaveBeenCalledWith(account, "repo-a", "PROD");
    expect(harness.current.value).toEqual({ NAME: "Zenblox" });
    expect(harness.current.error).toBe(false);

    harness.unmount();
  });

  it("surfaces an error and resets to emptyValue when fetching fails", async () => {
    fetcher.mockRejectedValue(new Error("network error"));
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });

    await waitFor(() => expect(harness.current.loading).toBe(false));

    expect(harness.current.error).toBe(true);
    expect(harness.current.value).toEqual({});

    harness.unmount();
  });

  it("resets to emptyValue and reloads when the target account/repo/env changes", async () => {
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });
    await waitFor(() => expect(harness.current.loading).toBe(false));
    expect(harness.current.value).toEqual({ NAME: "Zenblox" });

    fetcher.mockResolvedValue({ NAME: "Other" });
    harness.rerender({ account, repoName: "repo-b", envName: "PROD", emptyValue: {}, fetcher });

    await waitFor(() => expect(harness.current.loading).toBe(false));

    expect(fetcher).toHaveBeenLastCalledWith(account, "repo-b", "PROD");
    expect(harness.current.value).toEqual({ NAME: "Other" });

    harness.unmount();
  });

  it("only guards loading/error against a stale target change, not the value itself", async () => {
    // `cancelled` in the effect only skips the subsequent setLoading/setError — setValue inside
    // load() isn't guarded, so whichever fetch resolves last still wins the `value` state.
    let resolveFirst!: (value: Record<string, string>) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });

    fetcher.mockResolvedValue({ NAME: "Second" });
    harness.rerender({ account, repoName: "repo-b", envName: "PROD", emptyValue: {}, fetcher });
    await waitFor(() => expect(harness.current.loading).toBe(false));
    expect(harness.current.value).toEqual({ NAME: "Second" });

    await act(async () => {
      resolveFirst({ NAME: "Stale" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(harness.current.loading).toBe(false);
    expect(harness.current.value).toEqual({ NAME: "Stale" });

    harness.unmount();
  });

  it("re-fetches via onRefresh, toggling refreshing state", async () => {
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });
    await waitFor(() => expect(harness.current.loading).toBe(false));

    fetcher.mockResolvedValue({ NAME: "Refreshed" });

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = harness.current.onRefresh();
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(harness.current.refreshing).toBe(false);
    expect(harness.current.value).toEqual({ NAME: "Refreshed" });

    harness.unmount();
  });

  it("sets error when onRefresh fails", async () => {
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });
    await waitFor(() => expect(harness.current.loading).toBe(false));

    fetcher.mockRejectedValue(new Error("refresh failed"));

    await act(async () => {
      await harness.current.onRefresh();
    });

    expect(harness.current.error).toBe(true);

    harness.unmount();
  });

  it("does nothing on onRefresh when account, repoName, or envName is missing", async () => {
    const harness = renderHook<Record<string, string>>({
      account: null,
      repoName: null,
      envName: null,
      emptyValue: {},
      fetcher,
    });
    await waitFor(() => expect(harness.current.loading).toBe(false));

    await act(async () => {
      await harness.current.onRefresh();
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(harness.current.refreshing).toBe(false);

    harness.unmount();
  });

  it("applies a functional updater via setValue", async () => {
    const harness = renderHook<Record<string, string>>({
      account,
      repoName: "repo-a",
      envName: "PROD",
      emptyValue: {},
      fetcher,
    });
    await waitFor(() => expect(harness.current.loading).toBe(false));

    act(() => {
      harness.current.setValue((prev) => ({ ...prev, EXTRA: "value-1" }));
    });

    await waitFor(() => expect(harness.current.value).toEqual({ NAME: "Zenblox", EXTRA: "value-1" }));

    harness.unmount();
  });
});
