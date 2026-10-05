/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback } from "react";
import { fetchVariables } from "../api";
import type { Account } from "../types";
import { useGithubLoadable } from "./util/useGithubLoadable";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UseGithubVariablesParams = {
  account: Account | null;
  repoName: string | null;
  envName: string | null;
};

export interface UseGithubVariables {
  values: Record<string, string>;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  onRefresh: () => Promise<void>;
  onConfirmed: (key: string, value: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGithubVariables(opts: UseGithubVariablesParams): UseGithubVariables {
  const {
    value: values,
    setValue: setValues,
    loading,
    refreshing,
    error,
    onRefresh,
  } = useGithubLoadable({
    ...opts,
    emptyValue: {} as Record<string, string>,
    fetcher: fetchVariables,
  });

  const onConfirmed = useCallback(
    (key: string, value: string) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [setValues]
  );

  return { values, loading, refreshing, error, onRefresh, onConfirmed };
}
