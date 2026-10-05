/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from "react";
import type { Account, UpsertStatus } from "../../types";
import { createVariable, updateVariable, deleteVariable } from "../../api";

export type SaveResult = {
  result: "saved" | "no-changes" | "error";
  savedKeys: string[];
  newlySaved: Record<string, string>;
};

type Params = {
  keys: readonly string[];
  /*
   * Source of truth for "what's already saved". The caller owns it — a controlled
   * prop, full or scoped, the hook filters everything by `keys` internally either way.
   */
  savedValues: Record<string, string>;
  account: Account | null;
  repo: string;
  envName: string | null;
  onSavedKey?: (key: string, value: string) => void; // Called once per key that saves successfully, so the caller can record it.
  populate?: Record<string, string>; // External "suggested values" applied into the draft as they change (not auto-saved).
  autoSaveCounter?: number; // Increment to apply `populate` and immediately save it.
  onAutoSaveResult?: (result: SaveResult["result"]) => void; // Called when auto-save (triggered by autoSaveCounter) completes.
};

/*
 * Local/saved variable-editing core shared by the GitHub- and Azure-variables editors: tracks
 * edits, dirty state, the save loop, resync against external saves, and optional auto-save.
 */
export function useVariableEditor({ keys, savedValues, account, repo, envName, onSavedKey, populate, autoSaveCounter, onAutoSaveResult }: Params) {
  const [localValues, setLocalValues] = useState<Record<string, string>>(savedValues);
  const [upsertStatuses, setUpsertStatuses] = useState<UpsertStatus[]>([]);
  const [updating, setUpdating] = useState(false);
  const isDependenciesReady = account && repo && envName;

  // Resync the draft when `savedValues` actually changes at one of *this caller's own* keys —
  // scoped so an unrelated key changing elsewhere in a shared savedValues object doesn't wipe it.
  const [prevScoped, setPrevScoped] = useState<Record<string, string>>(() => {
    const scoped: Record<string, string> = {};
    for (const k of keys) scoped[k] = savedValues[k] ?? "";
    return scoped;
  });
  const changedKeys = keys.filter((k) => (savedValues[k] ?? "") !== (prevScoped[k] ?? ""));
  if (changedKeys.length > 0) {
    const nextScoped = { ...prevScoped };
    for (const k of changedKeys) nextScoped[k] = savedValues[k] ?? "";
    setPrevScoped(nextScoped);
    setLocalValues((cur) => {
      const next = { ...cur };
      for (const k of changedKeys) next[k] = savedValues[k] ?? "";
      return next;
    });
  }

  const dirtyKeys = keys.filter((k) => (localValues[k] ?? "") !== (savedValues[k] ?? ""));

  const onChange = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    setUpsertStatuses((prev) => prev.filter((s) => s.key !== key));
  };

  const onRevert = (key: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: savedValues[key] ?? "" }));
    setUpsertStatuses((prev) => prev.filter((s) => s.key !== key));
  };

  const onSave = async (overrideValues?: Record<string, string>): Promise<SaveResult> => {
    const vals = overrideValues ?? localValues;
    const newlySaved = { ...savedValues };
    if (!isDependenciesReady) return { result: "error", savedKeys: [], newlySaved };
    const dirty = keys.filter((k) => (vals[k] ?? "") !== (savedValues[k] ?? ""));
    if (dirty.length === 0) return { result: "no-changes", savedKeys: [], newlySaved };

    setUpdating(true);
    const statuses: UpsertStatus[] = [];
    let hasError = false;
    for (const key of dirty) {
      const value = vals[key] ?? "";
      const isNew = !savedValues[key];
      const isDelete = !isNew && !value;
      try {
        if (isDelete) await deleteVariable(account, repo, key, envName);
        else await (isNew ? createVariable : updateVariable)(account, repo, key, value, envName);
        statuses.push({ key, status: "success" });
        newlySaved[key] = value;
        onSavedKey?.(key, value);
      } catch (e) {
        console.error(`Failed to ${isDelete ? "delete" : isNew ? "create" : "update"} variable "${key}":`, e);
        statuses.push({ key, status: "error", error: "Save failed" });
        hasError = true;
      }
    }
    setUpsertStatuses(statuses);
    setUpdating(false);
    const savedKeys = statuses.filter((s) => s.status === "success").map((s) => s.key);
    return { result: hasError ? "error" : "saved", savedKeys, newlySaved };
  };

  // Always-current ref so the auto-save effect below calls the latest `onSave` closure.
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  const onAutoSaveResultRef = useRef(onAutoSaveResult);
  useEffect(() => {
    onAutoSaveResultRef.current = onAutoSaveResult;
  }, [onAutoSaveResult]);

  // Apply external "suggested values" into the draft as they change (no save).
  const prevPopulateRef = useRef<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!populate) {
      prevPopulateRef.current = undefined;
      return;
    }
    const prev = prevPopulateRef.current;
    const changed = Object.keys(populate).filter((k) => !prev || prev[k] !== populate[k]);
    prevPopulateRef.current = populate;
    if (changed.length === 0) return;
    setLocalValues((cur) => {
      const next = { ...cur };
      for (const k of changed) next[k] = populate[k];
      return next;
    });
    setUpsertStatuses((cur) => cur.filter((s) => !changed.includes(s.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [populate ? JSON.stringify(populate) : ""]);

  // When autoSaveCounter increments, apply populate into the draft and save it immediately.
  const prevAutoSaveCounterRef = useRef(autoSaveCounter);
  useEffect(() => {
    if (autoSaveCounter === undefined || autoSaveCounter === prevAutoSaveCounterRef.current || !populate) return;
    prevAutoSaveCounterRef.current = autoSaveCounter;
    setLocalValues((cur) => ({ ...cur, ...populate }));
    void (async () => {
      const result = await saveRef.current(populate);
      onAutoSaveResultRef.current?.(result.result);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveCounter]);

  return {
    localValues,
    setLocalValues,
    upsertStatuses,
    setUpsertStatuses,
    updating,
    dirtyKeys,
    onChange,
    onRevert,
    onSave,
  };
}
