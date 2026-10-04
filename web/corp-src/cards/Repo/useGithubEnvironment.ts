/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEnvs } from "../../api";
import { type Account, type Branch, type CardStatus, type GhEnv, type RepoOption } from "../../types";
import { matchBranch } from "./env";
import { findIgnoreCase } from "../../logic/search";
import type { UrlRestoreField } from "../../hooks/useUrlStateManager";
// ─── Types ────────────────────────────────────────────────────────────────────
export interface UseGithubEnvironment {
  // Env
  envList: GhEnv[];
  selectedEnv: GhEnv | null;
  setSelectedEnv: (env: GhEnv | null) => void;
  branchMatchWarning: string | null;
  branchMatchError: string | null;
  // Status
  envLoading: boolean;
  status: CardStatus;
  envRefreshFailed: boolean;
  // Actions
  onRefresh: () => void;
  // Restore
  restore: {
    env: UrlRestoreField;
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UseGithubEnvironmentParams = {
  account: Account | null;
  repo: RepoOption | null;
  isRepoReady: boolean;
  branches: Branch[];
};

export function useGithubEnvironment(opts: UseGithubEnvironmentParams): UseGithubEnvironment {
  const accountRef = useRef(opts.account);
  const repoRef = useRef(opts.repo);
  useEffect(() => {
    accountRef.current = opts.account;
    repoRef.current = opts.repo;
  });

  // ── Env state ─────────────────────────────────────────────────────────────
  const [envList, setEnvList] = useState<GhEnv[]>([]);
  const [envsLoaded, setEnvsLoaded] = useState(false);
  const [selectedEnv, setSelectedEnv] = useState<GhEnv | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [branchMatchWarning, setBranchMatchWarning] = useState<string | null>(null);
  const [branchMatchError, setBranchMatchError] = useState<string | null>(null);
  const [status, setStatus] = useState<CardStatus>("idle");
  const [envRefreshFailed, setEnvRefreshFailed] = useState(false);

  // Clear env + secrets when repo changes
  const prevRepoId = useRef<number | string | null | undefined>(undefined);
  useEffect(() => {
    const newId = opts.repo?.id ?? null;
    if (prevRepoId.current !== undefined && prevRepoId.current !== newId) {
      setEnvList([]);
      setEnvsLoaded(false);
      setSelectedEnv(null);
      setBranchMatchWarning(null);
      setBranchMatchError(null);
      setStatus("idle");
    }
    prevRepoId.current = newId;
  }, [opts.repo?.id]);

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadEnvs = useCallback(async (account: Account, repo: RepoOption) => {
    setEnvLoading(true);
    setEnvRefreshFailed(false);
    try {
      const list = await fetchEnvs(account, repo.name);
      setEnvList(list);
    } catch (e) {
      console.error(e);
      setEnvRefreshFailed(true);
    } finally {
      setEnvLoading(false);
      setEnvsLoaded(true);
    }
  }, []);

  // Load envs when repo is ready
  useEffect(() => {
    if (!opts.account || !opts.repo || !opts.isRepoReady) return;
    loadEnvs(opts.account, opts.repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.account?.id, opts.repo?.id, opts.isRepoReady, loadEnvs]);

  // When env selected: match against branch list
  useEffect(() => {
    if (!selectedEnv) {
      setBranchMatchWarning(null);
      setBranchMatchError(null);
      setStatus("idle");
      return;
    }
    const result = matchBranch(selectedEnv.name, opts.branches);
    if (result.status === "exact") {
      setBranchMatchWarning(null);
      setBranchMatchError(null);
      setStatus("complete");
    } else if (result.status === "case") {
      setBranchMatchWarning(`Environment "${selectedEnv.name}" and branch "${result.branch.name}" have mismatched casing.`);
      setBranchMatchError(null);
      setStatus("warning");
    } else if (result.status === "multiple") {
      setBranchMatchWarning(null);
      setBranchMatchError(`Multiple branches match environment "${selectedEnv.name}". Please resolve the conflict.`);
      setStatus("error");
    } else {
      setBranchMatchWarning(null);
      setBranchMatchError(`No branch found matching environment "${selectedEnv.name}".`);
      setStatus("error");
    }
  }, [selectedEnv, opts.branches]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const onRefresh = useCallback(() => {
    const acc = accountRef.current;
    const repo = repoRef.current;
    if (acc && repo) loadEnvs(acc, repo);
  }, [loadEnvs]);

  const restoreEnv = useCallback(
    (value: string): boolean => {
      const match = findIgnoreCase(envList, (e) => e.name, value);
      if (!match) return false;
      setSelectedEnv(match);
      return true;
    },
    [envList]
  );

  return {
    // Env
    envList,
    selectedEnv,
    setSelectedEnv,
    branchMatchWarning,
    branchMatchError,
    // Status
    envLoading,
    status,
    envRefreshFailed,
    // Actions
    onRefresh,
    // Restore
    restore: {
      env: { ready: envsLoaded, scope: opts.repo?.id ?? null, apply: restoreEnv },
    },
  };
}
