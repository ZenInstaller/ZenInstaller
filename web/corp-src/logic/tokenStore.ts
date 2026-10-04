/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { read, remove, write } from "./browserStore";

const memory = new Map<string, string>();

export function setStoredToken(key: string, token: string): void {
  memory.set(key, token);
  write(key, token);
}

// Takes the keys in priority order, so a provider with more than one kind of token picks its own.
export function getStoredToken(keys: readonly string[]): string | null {
  for (const key of keys) {
    const cached = memory.get(key);
    if (cached) return cached;
    const stored = read(key);
    if (stored) {
      memory.set(key, stored);
      return stored;
    }
  }
  return null;
}

export function clearStoredToken(key: string): void {
  memory.delete(key);
  remove(key);
}

// Says a sign-in got as far as a verified user, without anything having to read the token to ask.
export type LoginStatus = "success" | null;

const statusKey = (provider: string) => `${provider}_login`;

export function setLoginStatus(provider: string, status: LoginStatus): void {
  if (status) write(statusKey(provider), status);
  else remove(statusKey(provider));
}

export function getLoginStatus(provider: string): LoginStatus {
  return read(statusKey(provider)) === "success" ? "success" : null;
}
