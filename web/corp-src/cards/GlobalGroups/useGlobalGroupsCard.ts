import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMsal } from "../../auth/msal";
import { GROUPS_SCOPES, AZURE_CLIENT_ID } from "../../config/azureConfig";
import {
  listGroups,
  getGroupByName,
  getGroupParents,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  isGroupMember,
} from "../../api/azureGraph";
import { isConsentError } from "../../logic/consent";
import type { CardHook, CardRequirements, CardStatus, SetupStep, AzureAccount } from "../../types";

export type GroupRow = {
  id: string; // Entra group id once created; a "new:<uuid>" placeholder before creation
  groupName: string;
  description: string;
  memberOfGroupNames: string[]; // PARENT group names — same semantics as groups.csv's MemberOfGroups
  isNew: boolean; // not yet created in Entra
};

export type GroupRowResult = {
  status: SetupStep["status"];
  detail?: string;
  membershipIssues?: string[];
};

export type SavedGroup = { displayName: string; description: string; memberOfGroupNames: string[] };

// Verbatim from ZBCorpArchitecture/corpSetup/c02globalGroups/main.tf — offered via "Add default
// groups", never auto-seeded (an empty tenant just shows an empty list otherwise).
const DEFAULT_GROUPS: Omit<GroupRow, "id" | "isNew">[] = [
  {
    groupName: "ResourceGroupDeployer",
    description:
      "This group should be assigned as owner of the subscription and should be added as member of all administration groups that are required to deploy resources in the environment",
    memberOfGroupNames: ["DbAdmin-Dev", "DbAdmin-Test", "DbAdmin-Prod"],
  },
  {
    groupName: "LeadDeveloper",
    description: "This group is used to assign environment administration permissions to lead developers.",
    memberOfGroupNames: ["ResourceGroupDeployer"],
  },
  { groupName: "DbAdmin-Dev", description: "DB admins for Dev environments", memberOfGroupNames: [] },
  { groupName: "DbAdmin-Test", description: "DB admins for Test environments", memberOfGroupNames: [] },
  { groupName: "DbAdmin-Prod", description: "DB admins for Prod environments", memberOfGroupNames: [] },
];

function newRowId(): string {
  return `new:${crypto.randomUUID()}`;
}

// Entra requires a mailNickname on every group create, security-only or not.
function deriveMailNickname(groupName: string): string {
  return groupName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "group";
}

// A row is "dirty" when its draft hasn't been synced to Entra yet — a blank not-yet-named new
// row doesn't count (nothing to sync).
export function isRowDirty(row: GroupRow, savedById: Record<string, SavedGroup>): boolean {
  if (row.isNew) return !!row.groupName.trim();
  const saved = savedById[row.id];
  if (!saved) return true;
  const sameMembers =
    saved.memberOfGroupNames.length === row.memberOfGroupNames.length &&
    saved.memberOfGroupNames.every((n) => row.memberOfGroupNames.includes(n));
  return saved.displayName !== row.groupName || saved.description !== row.description || !sameMembers;
}

/*
 * Whether adding `candidateParentName` to `childName`'s "member of" list would close a cycle —
 * i.e. candidateParentName is already (directly or transitively) a member of childName. Walks
 * the draft membership graph (not Entra), so it reflects in-progress edits, not just synced
 * state. Pure/data-only so both the hook (future validation) and the card (filtering the
 * Member-of picker's options before a cycle can even be selected) can share it.
 */
export function wouldCreateCycle(rows: GroupRow[], childName: string, candidateParentName: string): boolean {
  if (!childName || !candidateParentName) return false;
  const child = childName.toLowerCase();
  const candidate = candidateParentName.toLowerCase();
  if (child === candidate) return true;
  const byName = new Map(rows.map((r) => [r.groupName.trim().toLowerCase(), r]));
  const visited = new Set<string>();
  const stack = [candidate];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === child) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const row = byName.get(current);
    if (!row) continue;
    for (const parent of row.memberOfGroupNames) stack.push(parent.trim().toLowerCase());
  }
  return false;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseGlobalGroupsCardParams = {
  azureAccount: AzureAccount | null;
  confirmedTenantId: string | null;
};

export interface UseGlobalGroupsCard extends CardHook {
  readonly cardId: "global_groups";
  rows: GroupRow[];
  savedById: Record<string, SavedGroup>;
  rowResults: Record<string, GroupRowResult>;
  rowErrors: Record<string, string>;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  addRow: () => void;
  addDefaultGroups: () => void;
  updateRow: (id: string, patch: Partial<Omit<GroupRow, "id" | "isNew">>) => void;
  removeRow: (id: string) => void; // only meaningful for un-created (isNew) rows
  revertRow: (id: string) => void; // discards local edits, restoring the last-synced Entra state
  pendingDeleteId: string | null;
  requestDeleteRow: (id: string) => void;
  cancelDeleteRow: () => void;
  confirmDeleteRow: () => Promise<void>;
  deleting: boolean;
  canSync: boolean;
  syncing: boolean;
  sync: () => Promise<void>;
  consentRequired: boolean;
  requestGroupsConsent: () => Promise<void>;
  // Narrowed from CardHook (optional there) — every card provides these.
  cardRequirements: CardRequirements;
  cardDependencyLabel: string;
}

/*
 * A lightweight Entra security-groups manager: the row list mirrors what actually exists in the
 * tenant (fetched live via listGroups/getGroupParents), with local drafts layered on top for
 * edits/creates/deletes not yet synced. "Add default groups" offers c02globalGroups's 5-group
 * template as a starting point — nothing is auto-seeded, an empty tenant just shows an empty list.
 */
export function useGlobalGroupsCard({
  azureAccount,
  confirmedTenantId,
}: UseGlobalGroupsCardParams): UseGlobalGroupsCard {
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [savedById, setSavedById] = useState<Record<string, SavedGroup>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [rowResults, setRowResults] = useState<Record<string, GroupRowResult>>({});
  const [syncing, setSyncing] = useState(false);
  const [consentRequired, setConsentRequired] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Load live state from Entra ───────────────────────────────────────────
  // Merges in fresh Entra state rather than replacing rows outright — a row the user is
  // mid-edit on (or hasn't created yet) survives a refresh instead of being silently discarded.
  const load = useCallback(
    async (markBusy: (v: boolean) => void) => {
      if (!azureAccount || !confirmedTenantId) return;
      markBusy(true);
      setConsentRequired(false);
      try {
        const groups = await listGroups(azureAccount, confirmedTenantId);
        const withParents = await Promise.all(
          groups.map(async (g) => {
            try {
              const parents = await getGroupParents(azureAccount, g.id, confirmedTenantId);
              return { ...g, memberOfGroupNames: parents.map((p) => p.displayName) };
            } catch {
              return { ...g, memberOfGroupNames: [] as string[] };
            }
          }),
        );
        const nextSaved: Record<string, SavedGroup> = {};
        let mergedIds = new Set<string>();
        setRows((prevRows) => {
          const prevById = new Map(prevRows.map((r) => [r.id, r]));
          const seenIds = new Set<string>();
          const merged: GroupRow[] = withParents.map((g) => {
            nextSaved[g.id] = {
              displayName: g.displayName,
              description: g.description,
              memberOfGroupNames: g.memberOfGroupNames,
            };
            seenIds.add(g.id);
            const prev = prevById.get(g.id);
            if (prev && isRowDirty(prev, savedById)) return prev;
            return {
              id: g.id,
              groupName: g.displayName,
              description: g.description,
              memberOfGroupNames: g.memberOfGroupNames,
              isNew: false,
            };
          });
          // Carry over rows the fresh fetch doesn't know about — un-created drafts, or a dirty
          // row for a group that's vanished from Entra since the last load.
          for (const r of prevRows) {
            if (!seenIds.has(r.id) && (r.isNew || isRowDirty(r, savedById))) merged.push(r);
          }
          mergedIds = new Set(merged.map((r) => r.id));
          return merged;
        });
        setSavedById(nextSaved);
        setRowResults((prev) => {
          const next: Record<string, GroupRowResult> = {};
          for (const id of Object.keys(prev)) {
            if (mergedIds.has(id)) next[id] = prev[id];
          }
          return next;
        });
        setHasLoadedOnce(true);
      } catch (err) {
        if (isConsentError(err instanceof Error ? err.message : "")) setConsentRequired(true);
      } finally {
        markBusy(false);
      }
    },
    [azureAccount, confirmedTenantId, savedById],
  );

  const refresh = useCallback(() => load(setRefreshing), [load]);

  // Initial load, once per account+tenant.
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!azureAccount || !confirmedTenantId) return;
    const key = `${azureAccount.homeAccountId}|${confirmedTenantId}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    void load(setLoading);
  }, [azureAccount, confirmedTenantId, load]);

  const rowErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.groupName.trim();
      if (!name) {
        errors[row.id] = "Group name is required";
        continue;
      }
      const lower = name.toLowerCase();
      if (seen.has(lower)) {
        errors[row.id] = "Duplicate group name";
        continue;
      }
      seen.add(lower);
    }
    return errors;
  }, [rows]);

  const canSync = rows.length > 0 && Object.keys(rowErrors).length === 0 && rows.some((r) => isRowDirty(r, savedById));

  // ── CRUD (local draft) ───────────────────────────────────────────────────
  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: newRowId(), groupName: "", description: "", memberOfGroupNames: [], isNew: true },
    ]);
  }, []);

  const addDefaultGroups = useCallback(() => {
    setRows((prev) => {
      const existingNames = new Set(prev.map((r) => r.groupName.trim().toLowerCase()));
      const toAdd = DEFAULT_GROUPS.filter((g) => !existingNames.has(g.groupName.toLowerCase())).map((g) => ({
        id: newRowId(),
        ...g,
        isNew: true,
      }));
      return [...prev, ...toAdd];
    });
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<Omit<GroupRow, "id" | "isNew">>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setRowResults((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Only meaningful for un-created rows — for a real group, use requestDeleteRow instead.
  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setRowResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Discards local edits on an existing group, restoring its last-synced Entra values.
  const revertRow = useCallback(
    (id: string) => {
      const saved = savedById[id];
      if (!saved) return;
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
              ...r,
              groupName: saved.displayName,
              description: saved.description,
              memberOfGroupNames: [...saved.memberOfGroupNames],
            }
            : r,
        ),
      );
      setRowResults((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [savedById],
  );

  // ── Two-step delete (real Entra groups only — irreversible, so it's confirm-then-act) ──
  const requestDeleteRow = useCallback((id: string) => setPendingDeleteId(id), []);
  const cancelDeleteRow = useCallback(() => setPendingDeleteId(null), []);

  const confirmDeleteRow = useCallback(async () => {
    if (!azureAccount || !confirmedTenantId || !pendingDeleteId) return;
    const id = pendingDeleteId;
    setDeleting(true);
    try {
      await deleteGroup(azureAccount, id, confirmedTenantId);
      setRows((prev) => prev.filter((r) => r.id !== id));
      setSavedById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setRowResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPendingDeleteId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete group";
      if (isConsentError(msg)) setConsentRequired(true);
      setRowResults((prev) => ({ ...prev, [id]: { status: "error", detail: msg } }));
    } finally {
      setDeleting(false);
    }
  }, [azureAccount, confirmedTenantId, pendingDeleteId]);

  // ── Consent ───────────────────────────────────────────────────────────────
  const requestGroupsConsent = useCallback(async () => {
    if (!azureAccount) return;
    const msal = await getMsal();
    if (!msal) return;
    await msal.acquireTokenRedirect({
      scopes: GROUPS_SCOPES,
      account: azureAccount,
      authority: `https://login.microsoftonline.com/${confirmedTenantId || azureAccount.tenantId}`,
    });
  }, [azureAccount, confirmedTenantId]);

  // ── Sync: create new / update changed / bidirectional membership sync ───
  const sync = useCallback(async () => {
    if (!azureAccount || !confirmedTenantId || rows.length === 0) return;
    setSyncing(true);
    setConsentRequired(false);

    const idByName = new Map<string, string>(); // groupName(lower) -> final Entra id, resolved this run
    const idRemap = new Map<string, string>(); // temp "new:" id -> real id, for rows created this run
    const outcomes: Record<string, GroupRowResult> = {}; // keyed by FINAL id

    // Phase 1: create new groups, update changed existing ones.
    for (const row of rows) {
      setRowResults((prev) => ({ ...prev, [row.id]: { status: "running" } }));
      let finalId = row.id;
      try {
        if (row.isNew) {
          const created = await createGroup(
            azureAccount,
            {
              displayName: row.groupName,
              description: row.description,
              mailNickname: deriveMailNickname(row.groupName),
            },
            confirmedTenantId,
          );
          finalId = created.id;
          idRemap.set(row.id, finalId);
          outcomes[finalId] = { status: "done" };
        } else {
          const saved = savedById[row.id];
          const changed = !saved || saved.displayName !== row.groupName || saved.description !== row.description;
          if (changed)
            await updateGroup(
              azureAccount,
              row.id,
              { displayName: row.groupName, description: row.description },
              confirmedTenantId,
            );
          outcomes[finalId] = { status: changed ? "done" : "skipped", detail: changed ? undefined : "No changes" };
        }
        idByName.set(row.groupName.toLowerCase(), finalId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        if (isConsentError(msg)) setConsentRequired(true);
        outcomes[finalId] = { status: "error", detail: msg };
      }
    }

    if (idRemap.size > 0) {
      setRows((prev) => prev.map((r) => (idRemap.has(r.id) ? { ...r, id: idRemap.get(r.id)!, isNew: false } : r)));
    }
    setRowResults((prev) => {
      const next = { ...prev };
      for (const oldId of idRemap.keys()) delete next[oldId];
      for (const [id, result] of Object.entries(outcomes)) next[id] = result;
      return next;
    });

    // Resolves a parent group's name to its Entra id — checks what this run already knows first,
    // else looks it up live (for a parent not among the currently-listed rows). `idByName` is a
    // plain local Map, not React state — react-hooks/immutability misidentifies it as derived
    // from `rows` here, so it's suppressed for this closure only.
    const resolveParentId = async (name: string): Promise<string | null> => {
      // eslint-disable-next-line react-hooks/immutability
      const known = idByName.get(name.toLowerCase());
      if (known) return known;
      const found = await getGroupByName(azureAccount, name, confirmedTenantId);
      if (found) idByName.set(name.toLowerCase(), found.id);
      return found?.id ?? null;
    };

    // Phase 2: bidirectional membership sync — add what's newly listed, remove what's no longer listed.
    for (const row of rows) {
      const childId = idRemap.get(row.id) ?? row.id;
      if (outcomes[childId]?.status === "error") continue;

      const savedParents = savedById[row.id]?.memberOfGroupNames ?? [];
      const savedParentsLower = new Set(savedParents.map((n) => n.toLowerCase()));
      const draftParentsLower = new Set(row.memberOfGroupNames.map((n) => n.toLowerCase()));
      const toAdd = row.memberOfGroupNames.filter((n) => !savedParentsLower.has(n.toLowerCase()));
      const toRemove = savedParents.filter((n) => !draftParentsLower.has(n.toLowerCase()));
      const issues: string[] = [];

      for (const parentName of toAdd) {
        try {
          const parentId = await resolveParentId(parentName);
          if (!parentId) {
            issues.push(`Parent group "${parentName}" not found`);
            continue;
          }
          const already = await isGroupMember(azureAccount, parentId, childId, confirmedTenantId);
          if (!already) await addGroupMember(azureAccount, parentId, childId, confirmedTenantId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed";
          if (isConsentError(msg)) setConsentRequired(true);
          issues.push(`${parentName}: ${msg}`);
        }
      }
      for (const parentName of toRemove) {
        try {
          const parentId = await resolveParentId(parentName);
          if (!parentId) continue; // parent already gone — nothing to remove
          await removeGroupMember(azureAccount, parentId, childId, confirmedTenantId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed";
          if (isConsentError(msg)) setConsentRequired(true);
          issues.push(`remove from ${parentName}: ${msg}`);
        }
      }

      setSavedById((prev) => ({
        ...prev,
        [childId]: {
          displayName: row.groupName,
          description: row.description,
          memberOfGroupNames: [...row.memberOfGroupNames],
        },
      }));
      if (issues.length > 0) {
        setRowResults((prev) => ({ ...prev, [childId]: { ...prev[childId], membershipIssues: issues } }));
      }
    }

    setSyncing(false);
  }, [azureAccount, confirmedTenantId, rows, savedById]);

  // ── CardHook ──────────────────────────────────────────────────────────────
  // Ongoing management, not a one-time setup step — "done" just means the tenant's live
  // group state has been loaded successfully at least once.
  const done = hasLoadedOnce;

  const azureConfigured = !!AZURE_CLIENT_ID;
  const hasError = Object.values(rowResults).some((r) => r.status === "error");
  // Assumes prerequisites are met — App locks this card (via cardRequirements) whenever they're not,
  // which overrides this status to "idle" regardless of what's computed here.
  const status: CardStatus = !azureConfigured ? "error" : hasError ? "error" : done ? "complete" : "warning";
  const summary = !azureConfigured
    ? "Unavailable"
    : loading
      ? "Loading groups..."
      : `${rows.length} group${rows.length === 1 ? "" : "s"}`;

  return {
    cardId: "global_groups" as const,
    rows,
    savedById,
    rowResults,
    rowErrors,
    loading,
    refreshing,
    refresh,
    addRow,
    addDefaultGroups,
    updateRow,
    removeRow,
    revertRow,
    pendingDeleteId,
    requestDeleteRow,
    cancelDeleteRow,
    confirmDeleteRow,
    deleting,
    canSync,
    syncing,
    sync,
    consentRequired,
    requestGroupsConsent,
    status,
    summary,
    cardRequirements: ["azure_login"],
    cardDependencyLabel: "Sign in to Azure",
    done,
  };
}
