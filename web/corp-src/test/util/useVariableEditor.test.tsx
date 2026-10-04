/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVariableEditor } from "../../hooks/util/useVariableEditor";
import type { Account } from "../../types";

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
    createVariable: vi.fn(),
    updateVariable: vi.fn(),
    deleteVariable: vi.fn(),
  },
}));

vi.mock("../../api", () => ({
  createVariable: apiMocks.createVariable,
  updateVariable: apiMocks.updateVariable,
  deleteVariable: apiMocks.deleteVariable,
}));

function HookHarness(
  props: Parameters<typeof useVariableEditor>[0] & {
    onUpdate: (value: ReturnType<typeof useVariableEditor>) => void;
  }
) {
  const value = useVariableEditor(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

async function waitForTick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useVariableEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.createVariable.mockResolvedValue(undefined);
    apiMocks.updateVariable.mockResolvedValue(undefined);
    apiMocks.deleteVariable.mockResolvedValue(undefined);
  });

  it("tracks edits and saves new and existing variables", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));
    let saveResult:
      | {
          result: "saved" | "no-changes" | "error";
          savedKeys: string[];
          newlySaved: Record<string, string>;
        }
      | undefined;

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME", "DNS"]}
          savedValues={{ NAME: "Zen" }}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
        />
      );
    });

    await act(async () => {
      latest?.onChange("NAME", "Zenblox");
      latest?.onChange("DNS", "zenblox.io");
    });

    await waitFor(() => {
      expect(latest?.dirtyKeys).toEqual(["NAME", "DNS"]);
    });

    await act(async () => {
      saveResult = await latest!.onSave();
    });
    expect(latest?.upsertStatuses).toEqual([
      { key: "NAME", status: "success" },
      { key: "DNS", status: "success" },
    ]);

    expect(saveResult).toEqual({
      result: "saved",
      savedKeys: ["NAME", "DNS"],
      newlySaved: { NAME: "Zenblox", DNS: "zenblox.io" },
    });
    expect(apiMocks.updateVariable).toHaveBeenCalledWith({ login: "org-one", type: "Organization", id: 101 }, "repo-one", "NAME", "Zenblox", "prod");
    expect(apiMocks.createVariable).toHaveBeenCalledWith({ login: "org-one", type: "Organization", id: 101 }, "repo-one", "DNS", "zenblox.io", "prod");

    await act(async () => {
      latest?.onChange("NAME", "Zenblox2");
    });

    await act(async () => {
      latest?.onRevert("DNS");
    });

    expect(latest?.localValues.DNS).toBe("");

    await act(async () => {
      root.unmount();
    });
  });

  it("returns no-changes when values already match the saved state", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));
    let saveResult:
      | {
          result: "saved" | "no-changes" | "error";
          savedKeys: string[];
          newlySaved: Record<string, string>;
        }
      | undefined;

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME"]}
          savedValues={{ NAME: "Zen" }}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
        />
      );
    });

    await act(async () => {
      saveResult = await latest!.onSave();
    });

    expect(saveResult?.result).toBe("no-changes");
    expect(apiMocks.updateVariable).not.toHaveBeenCalled();
    expect(apiMocks.createVariable).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("deletes a variable when its saved value is cleared", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME"]}
          savedValues={{ NAME: "Zen" }}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
        />
      );
    });

    await act(async () => {
      latest?.onChange("NAME", "");
    });

    let saveResult: Awaited<ReturnType<ReturnType<typeof useVariableEditor>["onSave"]>> | undefined;
    await act(async () => {
      saveResult = await latest!.onSave();
    });

    expect(apiMocks.deleteVariable).toHaveBeenCalledWith({ login: "org-one", type: "Organization", id: 101 }, "repo-one", "NAME", "prod");
    expect(saveResult).toEqual({ result: "saved", savedKeys: ["NAME"], newlySaved: { NAME: "" } });

    await act(async () => {
      root.unmount();
    });
  });

  it("returns an error immediately when account, repo, or envName is missing", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME"]}
          savedValues={{ NAME: "Zen" }}
          account={null}
          repo="repo-one"
          envName="prod"
        />
      );
    });

    await act(async () => {
      latest?.onChange("NAME", "Zenblox");
    });

    let saveResult: Awaited<ReturnType<ReturnType<typeof useVariableEditor>["onSave"]>> | undefined;
    await act(async () => {
      saveResult = await latest!.onSave();
    });

    expect(saveResult).toEqual({ result: "error", savedKeys: [], newlySaved: { NAME: "Zen" } });
    expect(apiMocks.createVariable).not.toHaveBeenCalled();
    expect(apiMocks.updateVariable).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("records a per-key error status when a save call throws, without failing other keys", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.updateVariable.mockRejectedValue(new Error("boom"));
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME", "DNS"]}
          savedValues={{ NAME: "Zen" }}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
        />
      );
    });

    await act(async () => {
      latest?.onChange("NAME", "Zenblox");
      latest?.onChange("DNS", "zenblox.io");
    });

    let saveResult: Awaited<ReturnType<ReturnType<typeof useVariableEditor>["onSave"]>> | undefined;
    await act(async () => {
      saveResult = await latest!.onSave();
    });

    expect(saveResult?.result).toBe("error");
    expect(saveResult?.savedKeys).toEqual(["DNS"]);
    expect(latest?.upsertStatuses).toEqual(
      expect.arrayContaining([
        { key: "NAME", status: "error", error: "Save failed" },
        { key: "DNS", status: "success" },
      ])
    );
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("calls onSavedKey for each key that saves successfully", async () => {
    const onSavedKey = vi.fn();
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME"]}
          savedValues={{}}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
          onSavedKey={onSavedKey}
        />
      );
    });

    await act(async () => {
      latest?.onChange("NAME", "Zenblox");
    });
    await act(async () => {
      await latest!.onSave();
    });

    expect(onSavedKey).toHaveBeenCalledWith("NAME", "Zenblox");

    await act(async () => {
      root.unmount();
    });
  });

  it("resyncs the draft when savedValues changes at a tracked key externally", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));
    const render = (savedValues: Record<string, string>) =>
      act(async () => {
        root.render(
          <HookHarness
            onUpdate={(value) => {
              latest = value;
            }}
            keys={["NAME"]}
            savedValues={savedValues}
            account={{ login: "org-one", type: "Organization", id: 101 }}
            repo="repo-one"
            envName="prod"
          />
        );
      });

    await render({ NAME: "Zen" });
    expect(latest?.localValues.NAME).toBe("Zen");

    await render({ NAME: "Updated externally" });

    expect(latest?.localValues.NAME).toBe("Updated externally");
    expect(latest?.dirtyKeys).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it("applies populate values into the draft without saving", async () => {
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
          keys={["NAME"]}
          savedValues={{}}
          account={{ login: "org-one", type: "Organization", id: 101 }}
          repo="repo-one"
          envName="prod"
          populate={{ NAME: "Suggested" }}
        />
      );
    });

    expect(latest?.localValues.NAME).toBe("Suggested");
    expect(apiMocks.createVariable).not.toHaveBeenCalled();
    expect(apiMocks.updateVariable).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("saves populate immediately when autoSaveCounter increments, reporting the result", async () => {
    const onAutoSaveResult = vi.fn();
    let latest: ReturnType<typeof useVariableEditor> | null = null;
    const root = createRoot(document.createElement("div"));
    const render = (autoSaveCounter: number) =>
      act(async () => {
        root.render(
          <HookHarness
            onUpdate={(value) => {
              latest = value;
            }}
            keys={["NAME"]}
            savedValues={{}}
            account={{ login: "org-one", type: "Organization", id: 101 }}
            repo="repo-one"
            envName="prod"
            populate={{ NAME: "Auto" }}
            autoSaveCounter={autoSaveCounter}
            onAutoSaveResult={onAutoSaveResult}
          />
        );
      });

    await render(0);
    await render(1);
    await waitForTick();

    expect(apiMocks.createVariable).toHaveBeenCalledWith({ login: "org-one", type: "Organization", id: 101 }, "repo-one", "NAME", "Auto", "prod");
    expect(onAutoSaveResult).toHaveBeenCalledWith("saved");
    expect(latest?.localValues.NAME).toBe("Auto");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not auto-save when autoSaveCounter increments without a populate value", async () => {
    const onAutoSaveResult = vi.fn();
    const root = createRoot(document.createElement("div"));
    const render = (autoSaveCounter: number) =>
      act(async () => {
        root.render(
          <HookHarness
            onUpdate={() => {}}
            keys={["NAME"]}
            savedValues={{}}
            account={{ login: "org-one", type: "Organization", id: 101 }}
            repo="repo-one"
            envName="prod"
            autoSaveCounter={autoSaveCounter}
            onAutoSaveResult={onAutoSaveResult}
          />
        );
      });

    await render(0);
    await render(1);
    await waitForTick();

    expect(apiMocks.createVariable).not.toHaveBeenCalled();
    expect(onAutoSaveResult).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
