/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from "react";
import type { Account } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseGithubLoadableParams<T> = {
  account: Account | null;
  repoName: string | null;
  envName: string | null;
  emptyValue: T;
  fetcher: (account: Account, repoName: string, envName: string) => Promise<T>;
};

export type UseGithubLoadable<T> = {
  value: T;
  setValue: (updater: T | ((prev: T) => T)) => void;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  onRefresh: () => Promise<void>;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

// Shared load-on-(account,repo,env)-change / refresh-on-demand pattern behind
// useGithubVariables (and any future useGithubSecrets) — only fetcher + emptyValue differ.
export function useGithubLoadable<T>({ account, repoName, envName, emptyValue, fetcher }: UseGithubLoadableParams<T>): UseGithubLoadable<T> {
  const [value, setValue] = useState<T>(emptyValue);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (!account || !repoName || !envName) return false;
    try {
      setValue(await fetcher(account, repoName, envName));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }, [account, repoName, envName, fetcher]);

  // Initial load whenever the target (account, repo, env) changes. Guarded by `cancelled` —
  // if the target changes again before this resolves, its result is discarded.
  useEffect(() => {
    setValue(emptyValue);
    setError(false);
    if (!(account && repoName && envName)) return;
    let cancelled = false;
    setLoading(true);
    load().then((ok) => {
      if (cancelled) return;
      if (!ok) setError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, repoName, envName]);

  const onRefresh = useCallback(async () => {
    if (!account || !repoName || !envName) return;
    setRefreshing(true);
    setError(false);
    try {
      const ok = await load();
      if (!ok) setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [account, repoName, envName, load]);

  return { value, setValue, loading, refreshing, error, onRefresh };
}
