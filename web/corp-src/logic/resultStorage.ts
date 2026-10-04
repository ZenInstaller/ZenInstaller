/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

/*
 * localStorage save/load pair for a card's persisted run result. Each card keeps its own
 * key and result type; only the read/write/parse-guard boilerplate is shared.
 */
export function createResultStorage<T>(key: string): {
  save: (r: T | null) => void;
  load: () => T | null;
} {
  return {
    save(r: T | null) {
      if (r) localStorage.setItem(key, JSON.stringify(r));
      else localStorage.removeItem(key);
    },
    load(): T | null {
      try {
        return JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        return null;
      }
    },
  };
}
