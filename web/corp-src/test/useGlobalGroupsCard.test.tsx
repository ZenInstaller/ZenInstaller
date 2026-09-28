import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountInfo } from "@azure/msal-browser";
import {
  useGlobalGroupsCard,
  isRowDirty,
  wouldCreateCycle,
  type UseGlobalGroupsCard,
  type GroupRow,
  type SavedGroup,
} from "../cards/GlobalGroups/useGlobalGroupsCard";

async function waitFor(assertion: () => void, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) throw error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    getMsal: vi.fn(),
    listGroups: vi.fn(),
    getGroupByName: vi.fn(),
    getGroupParents: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    isGroupMember: vi.fn(),
    isConsentError: vi.fn(),
  },
}));

const { configMocks } = vi.hoisted(() => ({
  configMocks: { azureClientId: "client-id" },
}));

vi.mock("../auth/msal", () => ({
  getMsal: apiMocks.getMsal,
}));

vi.mock("../api/azureGraph", () => ({
  listGroups: apiMocks.listGroups,
  getGroupByName: apiMocks.getGroupByName,
  getGroupParents: apiMocks.getGroupParents,
  createGroup: apiMocks.createGroup,
  updateGroup: apiMocks.updateGroup,
  deleteGroup: apiMocks.deleteGroup,
  addGroupMember: apiMocks.addGroupMember,
  removeGroupMember: apiMocks.removeGroupMember,
  isGroupMember: apiMocks.isGroupMember,
}));

vi.mock("../logic/consent", () => ({
  isConsentError: apiMocks.isConsentError,
}));

vi.mock("../config/azureConfig", () => ({
  get AZURE_CLIENT_ID() {
    return configMocks.azureClientId;
  },
  GROUPS_SCOPES: ["group.scope"],
}));

function HookHarness(
  props: { onUpdate: (value: UseGlobalGroupsCard) => void } & Parameters<typeof useGlobalGroupsCard>[0],
) {
  const value = useGlobalGroupsCard(props);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

function renderHook(params: Parameters<typeof useGlobalGroupsCard>[0]) {
  let latest: UseGlobalGroupsCard | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <HookHarness
        {...params}
        onUpdate={(v) => {
          latest = v;
        }}
      />,
    );
  });

  return {
    get current(): UseGlobalGroupsCard {
      if (!latest) throw new Error("Hook result not ready");
      return latest;
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

const account = { tenantId: "tenant-1", homeAccountId: "home-1" } as AccountInfo;

describe("useGlobalGroupsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMocks.azureClientId = "client-id";
    apiMocks.isConsentError.mockImplementation(
      (msg: string) => msg.includes("interaction_required") || msg.includes("consent_required"),
    );
    apiMocks.listGroups.mockResolvedValue([]);
    apiMocks.getGroupParents.mockResolvedValue([]);
    apiMocks.getMsal.mockResolvedValue({ acquireTokenRedirect: vi.fn().mockResolvedValue(undefined) });
  });

  describe("pure helpers", () => {
    it("isRowDirty: an unnamed new row is not dirty", () => {
      const row: GroupRow = { id: "new:1", groupName: "  ", description: "", memberOfGroupNames: [], isNew: true };
      expect(isRowDirty(row, {})).toBe(false);
    });

    it("isRowDirty: a named new row is dirty", () => {
      const row: GroupRow = { id: "new:1", groupName: "Team", description: "", memberOfGroupNames: [], isNew: true };
      expect(isRowDirty(row, {})).toBe(true);
    });

    it("isRowDirty: an existing row matching saved state is not dirty", () => {
      const row: GroupRow = { id: "g1", groupName: "Team", description: "desc", memberOfGroupNames: ["Parent"], isNew: false };
      const saved: Record<string, SavedGroup> = { g1: { displayName: "Team", description: "desc", memberOfGroupNames: ["Parent"] } };
      expect(isRowDirty(row, saved)).toBe(false);
    });

    it("isRowDirty: an existing row with changed members is dirty", () => {
      const row: GroupRow = { id: "g1", groupName: "Team", description: "desc", memberOfGroupNames: ["Other"], isNew: false };
      const saved: Record<string, SavedGroup> = { g1: { displayName: "Team", description: "desc", memberOfGroupNames: ["Parent"] } };
      expect(isRowDirty(row, saved)).toBe(true);
    });

    it("wouldCreateCycle: detects a direct self-cycle", () => {
      expect(wouldCreateCycle([], "Team", "Team")).toBe(true);
    });

    it("wouldCreateCycle: detects a transitive cycle", () => {
      const rows: GroupRow[] = [
        { id: "a", groupName: "A", description: "", memberOfGroupNames: ["B"], isNew: false },
        { id: "b", groupName: "B", description: "", memberOfGroupNames: ["C"], isNew: false },
        { id: "c", groupName: "C", description: "", memberOfGroupNames: [], isNew: false },
      ];
      expect(wouldCreateCycle(rows, "C", "A")).toBe(true);
    });

    it("wouldCreateCycle: returns false when no cycle would form", () => {
      const rows: GroupRow[] = [
        { id: "a", groupName: "A", description: "", memberOfGroupNames: [], isNew: false },
        { id: "b", groupName: "B", description: "", memberOfGroupNames: [], isNew: false },
      ];
      expect(wouldCreateCycle(rows, "A", "B")).toBe(false);
    });
  });

  describe("loading", () => {
    it("does not fetch when azureAccount or confirmedTenantId is missing", async () => {
      const harness = renderHook({ azureAccount: null, confirmedTenantId: null });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      expect(apiMocks.listGroups).not.toHaveBeenCalled();
      expect(harness.current.rows).toHaveLength(0);
      expect(harness.current.done).toBe(false);

      harness.unmount();
    });

    it("loads groups with their parents on mount", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "desc" }]);
      apiMocks.getGroupParents.mockResolvedValue([{ id: "p1", displayName: "Parent", description: "" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      expect(harness.current.rows).toEqual([
        { id: "g1", groupName: "Team", description: "desc", memberOfGroupNames: ["Parent"], isNew: false },
      ]);
      expect(harness.current.done).toBe(true);
      expect(harness.current.status).toBe("complete");

      harness.unmount();
    });

    it("sets consentRequired when loading fails with a consent error", async () => {
      apiMocks.listGroups.mockRejectedValue(new Error("interaction_required"));

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      expect(harness.current.consentRequired).toBe(true);
      expect(harness.current.done).toBe(false);

      harness.unmount();
    });

    it("refresh() re-fetches groups and toggles refreshing", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      apiMocks.listGroups.mockResolvedValue([
        { id: "g1", displayName: "Team", description: "" },
        { id: "g2", displayName: "Second", description: "" },
      ]);

      await act(async () => {
        await harness.current.refresh();
      });

      expect(harness.current.rows).toHaveLength(2);
      expect(harness.current.refreshing).toBe(false);

      harness.unmount();
    });
  });

  describe("row CRUD", () => {
    it("addRow appends a blank new row", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());

      expect(harness.current.rows).toHaveLength(1);
      expect(harness.current.rows[0]).toMatchObject({ groupName: "", description: "", memberOfGroupNames: [], isNew: true });

      harness.unmount();
    });

    it("addDefaultGroups skips groups that already exist by name", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "LeadDeveloper", description: "" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addDefaultGroups());

      const names = harness.current.rows.map((r) => r.groupName);
      expect(names).toContain("LeadDeveloper");
      expect(names.filter((n) => n === "LeadDeveloper")).toHaveLength(1);
      expect(names).toContain("ResourceGroupDeployer");

      harness.unmount();
    });

    it("updateRow patches fields and clears any stale row result", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const id = harness.current.rows[0].id;

      act(() => harness.current.updateRow(id, { groupName: "NewTeam" }));

      expect(harness.current.rows[0].groupName).toBe("NewTeam");
      expect(harness.current.rowResults[id]).toBeUndefined();

      harness.unmount();
    });

    it("removeRow deletes an un-created row", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const id = harness.current.rows[0].id;

      act(() => harness.current.removeRow(id));

      expect(harness.current.rows).toHaveLength(0);

      harness.unmount();
    });

    it("revertRow restores the last-synced values for an existing group", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "desc" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.updateRow("g1", { groupName: "Edited" }));
      expect(harness.current.rows[0].groupName).toBe("Edited");

      act(() => harness.current.revertRow("g1"));

      expect(harness.current.rows[0].groupName).toBe("Team");

      harness.unmount();
    });
  });

  describe("validation and canSync", () => {
    it("flags a blank group name as required", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const id = harness.current.rows[0].id;

      expect(harness.current.rowErrors[id]).toBe("Group name is required");
      expect(harness.current.canSync).toBe(false);

      harness.unmount();
    });

    it("flags a duplicate group name", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => {
        harness.current.addRow();
        harness.current.addRow();
      });
      const [firstId, secondId] = harness.current.rows.map((r) => r.id);
      act(() => {
        harness.current.updateRow(firstId, { groupName: "Team" });
        harness.current.updateRow(secondId, { groupName: "Team" });
      });

      expect(harness.current.rowErrors[secondId]).toBe("Duplicate group name");

      harness.unmount();
    });

    it("allows sync once a valid, dirty row exists", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const id = harness.current.rows[0].id;
      act(() => harness.current.updateRow(id, { groupName: "Team" }));

      expect(harness.current.canSync).toBe(true);

      harness.unmount();
    });
  });

  describe("delete", () => {
    it("confirmDeleteRow removes the group after a successful delete", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);
      apiMocks.deleteGroup.mockResolvedValue(undefined);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.requestDeleteRow("g1"));
      expect(harness.current.pendingDeleteId).toBe("g1");

      await act(async () => {
        await harness.current.confirmDeleteRow();
      });

      expect(apiMocks.deleteGroup).toHaveBeenCalledWith(account, "g1", "tenant-1");
      expect(harness.current.rows).toHaveLength(0);
      expect(harness.current.pendingDeleteId).toBeNull();

      harness.unmount();
    });

    it("cancelDeleteRow clears the pending delete without deleting", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.requestDeleteRow("g1"));
      act(() => harness.current.cancelDeleteRow());

      expect(harness.current.pendingDeleteId).toBeNull();
      expect(apiMocks.deleteGroup).not.toHaveBeenCalled();

      harness.unmount();
    });

    it("surfaces a row error and consent flag when delete fails", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);
      apiMocks.deleteGroup.mockRejectedValue(new Error("interaction_required"));

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.requestDeleteRow("g1"));
      await act(async () => {
        await harness.current.confirmDeleteRow();
      });

      expect(harness.current.rowResults["g1"]?.status).toBe("error");
      expect(harness.current.consentRequired).toBe(true);
      expect(harness.current.rows).toHaveLength(1);

      harness.unmount();
    });
  });

  describe("consent", () => {
    it("requestGroupsConsent triggers an acquireTokenRedirect for the groups scope", async () => {
      const acquireTokenRedirect = vi.fn().mockResolvedValue(undefined);
      apiMocks.getMsal.mockResolvedValue({ acquireTokenRedirect });

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      await act(async () => {
        await harness.current.requestGroupsConsent();
      });

      expect(acquireTokenRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ account, authority: "https://login.microsoftonline.com/tenant-1" }),
      );

      harness.unmount();
    });
  });

  describe("sync", () => {
    it("creates a new group and adds it to its selected parent", async () => {
      apiMocks.createGroup.mockResolvedValue({ id: "new-g1", displayName: "Team", description: "" });
      apiMocks.isGroupMember.mockResolvedValue(false);
      apiMocks.addGroupMember.mockResolvedValue(undefined);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const draftId = harness.current.rows[0].id;
      act(() => harness.current.updateRow(draftId, { groupName: "Team", memberOfGroupNames: ["Parent"] }));
      apiMocks.getGroupByName.mockResolvedValue({ id: "parent-1", displayName: "Parent", description: "" });

      await act(async () => {
        await harness.current.sync();
      });

      expect(apiMocks.createGroup).toHaveBeenCalledWith(
        account,
        expect.objectContaining({ displayName: "Team" }),
        "tenant-1",
      );
      expect(apiMocks.addGroupMember).toHaveBeenCalledWith(account, "parent-1", "new-g1", "tenant-1");
      expect(harness.current.rows[0]).toMatchObject({ id: "new-g1", isNew: false });
      expect(harness.current.rowResults["new-g1"]?.status).toBe("done");

      harness.unmount();
    });

    it("updates an existing group's changed fields", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "old" }]);
      apiMocks.updateGroup.mockResolvedValue(undefined);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.updateRow("g1", { description: "new" }));

      await act(async () => {
        await harness.current.sync();
      });

      expect(apiMocks.updateGroup).toHaveBeenCalledWith(
        account,
        "g1",
        { displayName: "Team", description: "new" },
        "tenant-1",
      );
      expect(harness.current.rowResults["g1"]?.status).toBe("done");

      harness.unmount();
    });

    it("skips updating an existing group with no changes", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "desc" }]);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      // Force dirty via a membership-only change so sync() proceeds despite unmodified name/description.
      act(() => harness.current.updateRow("g1", { memberOfGroupNames: ["Parent"] }));
      apiMocks.getGroupByName.mockResolvedValue({ id: "parent-1", displayName: "Parent", description: "" });
      apiMocks.isGroupMember.mockResolvedValue(false);

      await act(async () => {
        await harness.current.sync();
      });

      expect(apiMocks.updateGroup).not.toHaveBeenCalled();
      expect(harness.current.rowResults["g1"]?.status).toBe("skipped");

      harness.unmount();
    });

    it("removes membership in a parent no longer listed", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);
      apiMocks.getGroupParents.mockResolvedValue([{ id: "parent-1", displayName: "Parent", description: "" }]);
      apiMocks.getGroupByName.mockResolvedValue({ id: "parent-1", displayName: "Parent", description: "" });
      apiMocks.removeGroupMember.mockResolvedValue(undefined);

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));
      expect(harness.current.rows[0].memberOfGroupNames).toEqual(["Parent"]);

      act(() => harness.current.updateRow("g1", { memberOfGroupNames: [] }));

      await act(async () => {
        await harness.current.sync();
      });

      expect(apiMocks.removeGroupMember).toHaveBeenCalledWith(account, "parent-1", "g1", "tenant-1");

      harness.unmount();
    });

    it("sets consentRequired and a row error when creation fails with a consent error", async () => {
      apiMocks.createGroup.mockRejectedValue(new Error("consent_required"));

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.addRow());
      const draftId = harness.current.rows[0].id;
      act(() => harness.current.updateRow(draftId, { groupName: "Team" }));

      await act(async () => {
        await harness.current.sync();
      });

      expect(harness.current.consentRequired).toBe(true);
      expect(harness.current.rowResults[draftId]?.status).toBe("error");

      harness.unmount();
    });

    it("does nothing when there are no rows", async () => {
      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      await act(async () => {
        await harness.current.sync();
      });

      expect(apiMocks.createGroup).not.toHaveBeenCalled();
      expect(harness.current.syncing).toBe(false);

      harness.unmount();
    });
  });

  describe("status/summary", () => {
    it("reports Unavailable and error status when Azure is not configured", async () => {
      configMocks.azureClientId = "";

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      expect(harness.current.status).toBe("error");
      expect(harness.current.summary).toBe("Unavailable");

      harness.unmount();
    });

    it("reports an error status when any row result has failed", async () => {
      apiMocks.listGroups.mockResolvedValue([{ id: "g1", displayName: "Team", description: "" }]);
      apiMocks.deleteGroup.mockRejectedValue(new Error("boom"));

      const harness = renderHook({ azureAccount: account, confirmedTenantId: "tenant-1" });
      await waitFor(() => expect(harness.current.loading).toBe(false));

      act(() => harness.current.requestDeleteRow("g1"));
      await act(async () => {
        await harness.current.confirmDeleteRow();
      });

      expect(harness.current.status).toBe("error");

      harness.unmount();
    });
  });
});
