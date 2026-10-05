/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { captureOAuthReturn } from "../logic/oauth";

// ─── Types ───────────────────────────────────────────────────────────────────

export type UrlRestoreField = {
  ready: boolean;
  scope?: string | number | null;
  apply: (value: string) => boolean;
};

export type UrlRestoreChain = Record<string, UrlRestoreField>;
export type UrlRestoreChainConfig = {
  active: boolean;
  disabled?: boolean;
  fields: UrlRestoreChain;
};

export type UseUrlRestoreResult = {
  completed: boolean;
  restoring: boolean;
  warnings: string[];
  dismissWarnings: () => void;
  cancel: (keys?: string[]) => void;
};
// An OAuth return lands on the bare origin, so the restore params are not on the address bar yet.
captureOAuthReturn();

// TODO: belongs to app startup, not URL restore, move to a shared startup module.
export const INITIAL_URL_PARAMS = new URLSearchParams(window.location.search);

const RESTORE_TIMEOUT_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeInitialPending(chains: UrlRestoreChainConfig[]): Record<string, string> {
  const pending: Record<string, string> = {};
  for (const chain of chains) {
    if (chain.disabled) continue; // never queue keys for a chain that can never resolve
    for (const key of Object.keys(chain.fields)) {
      const value = INITIAL_URL_PARAMS.get(key);
      if (value !== null) pending[key] = value;
    }
  }
  return pending;
}

function readySignature(chains: UrlRestoreChainConfig[]): string {
  return chains
    .map(
      (chain) =>
        `${chain.active ? 1 : 0}:${chain.disabled ? 1 : 0}:` +
        Object.entries(chain.fields)
          .map(([key, field]) => `${key}:${field.ready ? 1 : 0}:${field.scope ?? "-"}`)
          .join("|")
    )
    .join("||");
}

// Actively in-flight: some non-disabled, active chain still has a key waiting on it.
function computeRestoring(chains: UrlRestoreChainConfig[], pending: Record<string, string>): boolean {
  return chains.some((chain) => !chain.disabled && chain.active && Object.keys(chain.fields).some((k) => k in pending));
}

function buildQueryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

// ─── URL Restore ─────────────────────────────────────────────────────────────

export function useUrlRestore(chains: UrlRestoreChainConfig[]): UseUrlRestoreResult {
  const pendingRef = useRef<Record<string, string>>(computeInitialPending(chains));
  const [completed, setCompleted] = useState(() => Object.keys(computeInitialPending(chains)).length === 0);
  const [restoring, setRestoring] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const chainsRef = useRef(chains);
  useEffect(() => {
    chainsRef.current = chains;
  });

  const readySig = readySignature(chains);

  useEffect(() => {
    if (completed) return;
    const pending = pendingRef.current;
    const newWarnings: string[] = [];

    for (const chain of chainsRef.current) {
      if (chain.disabled) {
        Object.keys(chain.fields).forEach((k) => delete pending[k]); // can never resolve — drop immediately
        continue;
      }
      if (!chain.active) continue; // inactive chains sit untouched — not attempted, not timed out
      for (const key of Object.keys(chain.fields)) {
        if (!(key in pending)) continue;
        const field = chain.fields[key];
        if (!field.ready) break; // not ready yet — retry when readySig changes
        const value = pending[key];
        delete pending[key];
        if (!field.apply(value)) {
          newWarnings.push(`"${value}" not found`);
          Object.keys(chain.fields).forEach((k) => delete pending[k]); // cascade-abort this chain only
        }
        break;
      }
    }

    if (newWarnings.length > 0) setWarnings((prev) => [...prev, ...newWarnings]);
    if (Object.keys(pending).length === 0) setCompleted(true);
    setRestoring(computeRestoring(chainsRef.current, pending));
  }, [readySig, completed]);

  useEffect(() => {
    if (completed) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const chain of chainsRef.current) {
      if (chain.disabled || !chain.active) continue;
      const chainPending = Object.keys(chain.fields).filter((k) => k in pendingRef.current);
      if (chainPending.length === 0) continue;
      timers.push(
        setTimeout(() => {
          const dropped = chainPending.filter((k) => k in pendingRef.current);
          if (dropped.length === 0) return;
          dropped.forEach((k) => delete pendingRef.current[k]);
          setWarnings((prev) => [...prev, `Could not restore from link: ${dropped.join(", ")}`]);
          if (Object.keys(pendingRef.current).length === 0) setCompleted(true);
          setRestoring(computeRestoring(chainsRef.current, pendingRef.current));
        }, RESTORE_TIMEOUT_MS)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [readySig, completed]);

  const dismissWarnings = useCallback(() => setWarnings([]), []);

  const cancel = useCallback((keys?: string[]) => {
    if (keys === undefined) {
      pendingRef.current = {};
    } else {
      keys.forEach((k) => delete pendingRef.current[k]);
    }
    if (Object.keys(pendingRef.current).length === 0) setCompleted(true);
    setRestoring(computeRestoring(chainsRef.current, pendingRef.current));
  }, []);

  return { completed, restoring, warnings, dismissWarnings, cancel };
}

// ─── URL Sync ────────────────────────────────────────────────────────────────

export function useUrlSync(values: Record<string, string | undefined>, enabled: boolean): void {
  const query = buildQueryString(values);

  useEffect(() => {
    if (!enabled) return;
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [query, enabled]);
}
