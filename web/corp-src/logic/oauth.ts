/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { base64UrlEncode, generateRandomString, sha256 } from "./crypto";
import { read, remove, write } from "./browserStore";

// ─── PKCE ─────────────────────────────────────────────────────────────────────

export async function generateCodeChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(await sha256(verifier));
}

export function encodeOAuthState(provider: string, url: string): string {
  return `${provider}:${url}`;
}

export async function requestAuthorizationCode(opts: {
  provider: string;
  authorizeUrl: string;
  clientId: string;
  scope: string;
  verifierKey: string;
}): Promise<void> {
  const verifier = generateRandomString();
  const challenge = await generateCodeChallenge(verifier);
  write(opts.verifierKey, verifier);

  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: window.location.origin,
    scope: opts.scope,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Carries the provider and the pre-login URL, so the callback knows whose code it is.
    state: encodeOAuthState(opts.provider, window.location.href),
  });
  window.location.href = `${opts.authorizeUrl}?${params}`;
}

// ─── Coming back ──────────────────────────────────────────────────────────────

// the code waits between landing on the page and being exchanged
const PENDING_CODE_KEY = "oauth_pending_code";
const PENDING_PROVIDER_KEY = "oauth_pending_provider";

function storePendingCode(provider: string, code: string): void {
  write(PENDING_CODE_KEY, code);
  write(PENDING_PROVIDER_KEY, provider);
}

// Reading clears it, so a failed exchange is not retried against a code the provider has spent.
export function takePendingCode(provider: string): string | null {
  if (read(PENDING_PROVIDER_KEY) !== provider) return null;
  const code = read(PENDING_CODE_KEY);
  remove(PENDING_CODE_KEY);
  remove(PENDING_PROVIDER_KEY);
  return code;
}

// ── The return leg itself ──

// Pure: what the provider put on the address bar, with nothing read or written.
export function parseOAuthReturn(search: string): { code: string; provider: string; returnUrl: string } | null {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  if (!code) return null;

  const state = params.get("state") ?? "";
  const separator = state.indexOf(":");
  return {
    code,
    provider: separator > 0 ? state.slice(0, separator) : "",
    returnUrl: separator > 0 ? state.slice(separator + 1) : "",
  };
}

export function captureOAuthReturn(): void {
  const returned = parseOAuthReturn(window.location.search);
  if (!returned) return;
  storePendingCode(returned.provider, returned.code);
  window.history.replaceState({}, "", returned.returnUrl || window.location.pathname);
}
