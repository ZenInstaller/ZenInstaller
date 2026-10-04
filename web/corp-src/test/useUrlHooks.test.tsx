/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type UrlHooksModule = typeof import("../hooks/useUrlStateManager");

function waitFor(assertion: () => void, timeoutMs = 1500) {
  const start = Date.now();
  return new Promise<void>(async (resolve, reject) => {
    while (true) {
      try {
        assertion();
        resolve();
        return;
      } catch (error) {
        if (Date.now() - start > timeoutMs) {
          reject(error);
          return;
        }
        await act(async () => {
          await new Promise((done) => setTimeout(done, 0));
        });
      }
    }
  });
}

async function importUrlHooks(search = ""): Promise<UrlHooksModule> {
  window.history.replaceState({}, "", `/start${search}#hash`);
  vi.resetModules();
  return import("../hooks/useUrlStateManager");
}

describe("useUrlRestore and useUrlSync", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("restores URL fields in order and clears the pending state", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=org-one&repo=repo-one");
    const applied: string[] = [];
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness(props: { repoReady: boolean }) {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: true,
              apply: (value) => {
                applied.push(`account:${value}`);
                return true;
              },
            },
            repo: {
              ready: props.repoReady,
              apply: (value) => {
                applied.push(`repo:${value}`);
                return true;
              },
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness repoReady={false} />);
    });

    await waitFor(() => {
      expect(applied).toEqual(["account:org-one"]);
    });

    await act(async () => {
      root.render(<Harness repoReady={true} />);
    });

    await waitFor(() => {
      expect(applied).toEqual(["account:org-one", "repo:repo-one"]);
      expect(latest?.completed).toBe(true);
      expect(latest?.restoring).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("updates the browser URL when sync is enabled", async () => {
    window.history.replaceState({}, "", "/start#hash");
    vi.resetModules();
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { useUrlSync } = await import("../hooks/useUrlStateManager");

    function Harness() {
      useUrlSync({ account: "org-one", repo: "repo-one", env: undefined }, true);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Harness />);
    });

    expect(replaceState).toHaveBeenCalledWith(null, "", "/start?account=org-one&repo=repo-one#hash");

    await act(async () => {
      root.unmount();
    });
    replaceState.mockRestore();
  });

  it("ignores disabled chains in initial pending queue and null URL values", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=org-one");
    const applied: string[] = [];
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          disabled: true,
          fields: {
            account: {
              ready: true,
              apply: (v) => {
                applied.push(`disabled:${v}`);
                return true;
              },
            },
          },
        },
        {
          active: true,
          fields: {
            account: {
              ready: true,
              apply: (v) => {
                applied.push(`enabled:${v}`);
                return true;
              },
            },
            repo: {
              ready: true,
              apply: () => {
                applied.push("repo-should-not-run");
                return true;
              },
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(applied).toEqual([]);
      expect(latest?.completed).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("retries when field is not ready and becomes ready after scope/active signature change", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=org-one&repo=repo-one");
    const applied: string[] = [];
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness(props: { active: boolean; accountReady: boolean; scope: string }) {
      const value = useUrlRestore([
        {
          active: props.active,
          fields: {
            account: {
              ready: props.accountReady,
              scope: props.scope,
              apply: (v) => {
                applied.push(`account:${v}`);
                return true;
              },
            },
            repo: {
              ready: true,
              apply: (v) => {
                applied.push(`repo:${v}`);
                return true;
              },
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness active={false} accountReady={false} scope="s1" />);
    });

    await waitFor(() => {
      expect(applied).toEqual([]);
      expect(latest?.restoring).toBe(false);
    });

    await act(async () => {
      root.render(<Harness active={true} accountReady={false} scope="s1" />);
    });

    await waitFor(() => {
      expect(applied).toEqual([]);
      expect(latest?.restoring).toBe(true);
    });

    await act(async () => {
      root.render(<Harness active={true} accountReady={true} scope="s2" />);
    });

    await waitFor(() => {
      expect(applied).toEqual(["account:org-one"]);
    });

    await act(async () => {
      root.render(<Harness active={true} accountReady={true} scope="s3" />);
    });

    await waitFor(() => {
      expect(applied).toEqual(["account:org-one", "repo:repo-one"]);
      expect(latest?.completed).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("adds not-found warning and cascade-aborts the rest of that chain", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=missing&repo=repo-one");
    const repoApply = vi.fn();
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: true,
              apply: () => false,
            },
            repo: {
              ready: true,
              apply: repoApply,
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(latest?.warnings).toEqual(['"missing" not found']);
      expect(repoApply).not.toHaveBeenCalled();
      expect(latest?.completed).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("creates timeout warning only for active non-disabled pending chains", async () => {
    vi.useFakeTimers();
    const { useUrlRestore } = await importUrlHooks("?account=org-one&repo=repo-one&env=prod");
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: false,
              apply: () => true,
            },
          },
        },
        {
          active: false,
          fields: {
            repo: {
              ready: false,
              apply: () => true,
            },
          },
        },
        {
          active: true,
          disabled: true,
          fields: {
            env: {
              ready: false,
              apply: () => true,
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(latest?.restoring).toBe(true);
    });

    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    expect(latest?.warnings).toEqual(["Could not restore from link: account"]);
    expect(latest?.completed).toBe(false);
    expect(latest?.restoring).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("timer callback exits early when pending keys were canceled before timeout", async () => {
    vi.useFakeTimers();
    const { useUrlRestore } = await importUrlHooks("?account=org-one");
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: false,
              apply: () => true,
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(latest?.completed).toBe(false);
    });

    await act(async () => {
      latest?.cancel(["account"]);
    });

    await act(async () => {
      vi.advanceTimersByTime(10_001);
    });

    await waitFor(() => {
      expect(latest?.warnings).toEqual([]);
      expect(latest?.completed).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("dismissWarnings clears accumulated warnings", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=missing");
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: true,
              apply: () => false,
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    await waitFor(() => {
      expect(latest?.warnings).toEqual(['"missing" not found']);
    });

    await act(async () => {
      latest?.dismissWarnings();
    });

    expect(latest?.warnings).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it("cancel supports specific keys and cancel-all", async () => {
    const { useUrlRestore } = await importUrlHooks("?account=org-one&repo=repo-one");
    let latest: ReturnType<typeof useUrlRestore> | null = null;
    const root = createRoot(document.createElement("div"));

    function Harness() {
      const value = useUrlRestore([
        {
          active: true,
          fields: {
            account: {
              ready: false,
              apply: () => true,
            },
            repo: {
              ready: false,
              apply: () => true,
            },
          },
        },
      ]);
      useEffect(() => {
        latest = value;
      }, [value]);
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    await waitFor(() => {
      expect(latest?.restoring).toBe(true);
      expect(latest?.completed).toBe(false);
    });

    await act(async () => {
      latest?.cancel(["account"]);
    });

    await waitFor(() => {
      expect(latest?.restoring).toBe(true);
      expect(latest?.completed).toBe(false);
    });

    await act(async () => {
      latest?.cancel();
    });

    expect(latest?.restoring).toBe(false);
    expect(latest?.completed).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not update URL when sync is disabled", async () => {
    const { useUrlSync } = await importUrlHooks("?from=keep");
    const replaceState = vi.spyOn(window.history, "replaceState");

    function Harness() {
      useUrlSync({ account: "org-one", repo: "repo-one" }, false);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Harness />);
    });

    expect(replaceState).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    replaceState.mockRestore();
  });

  it("sync builds URL from pathname, query, and hash", async () => {
    const { useUrlSync } = await importUrlHooks("");
    const replaceState = vi.spyOn(window.history, "replaceState");

    function Harness() {
      useUrlSync({ account: "org-one", repo: "repo-one", env: undefined }, true);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<Harness />);
    });

    await waitFor(() => {
      expect(replaceState).toHaveBeenCalledWith(null, "", "/start?account=org-one&repo=repo-one#hash");
    });

    await act(async () => {
      root.unmount();
    });
    replaceState.mockRestore();
  });
});
