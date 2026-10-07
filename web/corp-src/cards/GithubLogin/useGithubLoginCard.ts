/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { verifyAuth, switchToDirect, switchToBackend, fetchGithubUser } from "../../api";
import { BACKEND_CONFIGURED, exchangeGithubCode } from "../../api/backend";
import { requestAuthorizationCode, takePendingCode } from "../../logic/oauth";
import { read, remove } from "../../logic/browserStore";
import { clearStoredToken, getStoredToken, setLoginStatus, setStoredToken } from "../../logic/tokenStore";
import type { LoginStatus } from "../../logic/tokenStore";
import {
  GITHUB_AUTHORIZE_URL,
  GITHUB_CLIENT_ID,
  GITHUB_PROVIDER,
  GITHUB_SCOPES,
  GITHUB_TOKEN_KEY,
  GITHUB_TOKEN_KEYS,
  GITHUB_VERIFIER_KEY,
  type GithubTokenKey,
} from "../../config/githubConfig";
import type { CardHook, CardStatus, LoginHook, User } from "../../types";

const AUTH_RECORD_KEY = "zeninstaller_github_auth";

// ─── Types ────────────────────────────────────────────────────────────────────
export type GithubAuthRecord = { mode: "direct"; token: string } | { mode: "backend" };

export interface UseGithubLoginCard extends CardHook, LoginHook<User> {
  readonly cardId: "github_login";
  sessionExpired: boolean;
  redirecting: "login" | "logout" | null;
  status: CardStatus; // "loading" while the auth check is in-flight; "complete" once signed in; "idle" otherwise.
  cardDependencyLabel: string; // Label for the dependency that this card provides to others (e.g. "Sign in to GitHub")

  mode: GithubAuthRecord["mode"] | null;
  setMode: (mode: GithubAuthRecord["mode"]) => void;
  backendAvailable: boolean; // False without VITE_API_URL: the OAuth flow has no backend to exchange the code.
  token: string | null;
  setToken: (token: string | null) => void;
}

// ─── Sign-in ──────────────────────────────────────────────────────────────────
// The GitHub sign-in itself. The mechanism is in logic/oauth, the constants in config/githubConfig.

function setGithubLoginStatus(status: LoginStatus): void {
  setLoginStatus(GITHUB_PROVIDER, status);
}

export function clearGithubToken(key?: GithubTokenKey): void {
  setGithubLoginStatus(null);
  if (key) {
    clearStoredToken(key);
    return;
  }
  for (const k of GITHUB_TOKEN_KEYS) clearStoredToken(k);
  remove(GITHUB_VERIFIER_KEY);
}

async function requestCode(): Promise<void> {
  return requestAuthorizationCode({
    provider: GITHUB_PROVIDER,
    authorizeUrl: GITHUB_AUTHORIZE_URL,
    clientId: GITHUB_CLIENT_ID,
    scope: GITHUB_SCOPES,
    verifierKey: GITHUB_VERIFIER_KEY,
  });
}

// Trades the code GitHub redirected back with for a token, and remembers it.
async function exchangeToken(code: string): Promise<string> {
  const verifier = read(GITHUB_VERIFIER_KEY) ?? "";
  const data = await exchangeGithubCode({
    client_id: GITHUB_CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: window.location.origin,
  });
  if (!data.access_token) throw new Error(data.error ?? "Token exchange failed");
  setStoredToken(GITHUB_TOKEN_KEY, data.access_token);
  remove(GITHUB_VERIFIER_KEY);
  return data.access_token;
}

// Signing out is entirely local, so anything left behind is a token someone could reuse.
function clearStoredCredentials(): void {
  clearGithubToken();
}

// Whichever sign-in left a token behind — the OAuth one, or a pasted personal access token.
function readStoredToken(): string | null {
  return getStoredToken(GITHUB_TOKEN_KEYS);
}

// Narrowed to this provider so callers do not have to know the discriminator.
function takeGithubCode(): string | null {
  return takePendingCode(GITHUB_PROVIDER);
}

// ─── Storage ──────────────────────────────────────────────────────────────────
export function readGithubAuthRecord(): GithubAuthRecord | null {
  const raw = sessionStorage.getItem(AUTH_RECORD_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GithubAuthRecord;
  } catch {
    return null;
  }
}

function writeGithubAuthRecord(record: GithubAuthRecord | null): void {
  if (record === null) sessionStorage.removeItem(AUTH_RECORD_KEY);
  else sessionStorage.setItem(AUTH_RECORD_KEY, JSON.stringify(record));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGithubLoginCard(): UseGithubLoginCard {
  const [loggingIn, setLoggingIn] = useState(true);
  const [account, setAccount] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false); // TODO: check if this is still needed
  const [redirecting, setRedirecting] = useState<"login" | "logout" | null>(null);
  const [mode, setMode] = useState<GithubAuthRecord["mode"]>(BACKEND_CONFIGURED ? "backend" : "direct");
  const [token, setToken] = useState<string | null>(null);
  const loginConfigRef = useRef<GithubAuthRecord>(BACKEND_CONFIGURED ? { mode: "backend" } : { mode: "direct", token: "" });

  const setModeState = useCallback((nextMode: GithubAuthRecord["mode"]) => {
    if (nextMode === "backend" && !BACKEND_CONFIGURED) return;
    setMode(nextMode);

    if (nextMode === "backend") {
      loginConfigRef.current = { mode: nextMode };
    } else {
      loginConfigRef.current = {
        mode: nextMode,
        token: loginConfigRef.current.mode === "direct" ? loginConfigRef.current.token : "",
      };
    }
  }, []);

  const setTokenState = useCallback((nextToken: string | null) => {
    setToken(nextToken);

    if (loginConfigRef.current.mode === "direct") {
      loginConfigRef.current = {
        mode: "direct",
        token: nextToken ?? "",
      };
    }
  }, []);

  // Verify session on mount
  useEffect(() => {
    async function init() {
      // ── Returning from GitHub: oauthReturn already put the URL back, so only the code is left ──
      const code = takeGithubCode();
      if (code) {
        // Distinguishes trading the code from the ordinary session check; both keep loggingIn true.
        setRedirecting("login");
        try {
          const token = await exchangeToken(code);
          writeGithubAuthRecord({ mode: "backend" });
          setModeState("backend");
          switchToBackend();
          // Asked directly because the proxy's own identity check is what we are establishing here.
          const data = await fetchGithubUser(token);
          setAccount({ login: data.login });
          setGithubLoginStatus("success");
        } catch (e) {
          console.error("GitHub token exchange failed:", e);
          setSessionExpired(true);
        } finally {
          setRedirecting(null);
          setLoggingIn(false);
        }
        return;
      }

      const record = readGithubAuthRecord();
      if (record?.mode === "backend" && !BACKEND_CONFIGURED) {
        writeGithubAuthRecord(null);
        setLoggingIn(false);
        return;
      }
      if (!record) {
        setLoggingIn(false);
        return;
      }
      setModeState(record.mode);
      // Either way the browser holds the token; the mode decides who spends it on GitHub's API.
      const token = record.mode === "direct" ? record.token : readStoredToken();
      if (!token) {
        setLoggingIn(false);
        return;
      }
      if (record.mode === "direct") {
        setTokenState(token);
        switchToDirect(token);
      } else {
        switchToBackend();
      }
      try {
        const data = await verifyAuth();
        setAccount({ login: data.login });
        setGithubLoginStatus("success");
        setSessionExpired(false);
      } catch {
        setAccount(null);
        setSessionExpired(true);
      } finally {
        setLoggingIn(false);
      }
    }
    init();
  }, []);

  // TODO: check if this is still needed
  // Listen for server-side session expiry events
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, []);

  const login = useCallback(async () => {
    const config = loginConfigRef.current;
    switch (config.mode) {
      case "direct":
        if (!config.token) {
          // TODO: PATerror
          console.error("Missing PAT");
          return;
        }
        switchToDirect(config.token);
        break;

      case "backend":
        if (!BACKEND_CONFIGURED) {
          console.error("Backend sign-in needs VITE_API_URL");
          return;
        }
        // No stored token: send the user to GitHub and pick things up in the callback above.
        setRedirecting("login");
        await requestCode();
        return;
    }

    setRedirecting("login");
    try {
      writeGithubAuthRecord(config);
      setSessionExpired(false);
      const data = await verifyAuth();
      setAccount({ login: data.login });
      setGithubLoginStatus("success");
      setRedirecting(null);
    } catch {
      setAccount(null);
      console.error("Login failed");
      setSessionExpired(true);
      setRedirecting(null);
    } finally {
      setLoggingIn(false);
    }
  }, []);

  // Nothing server-side to end: the token lived here, so dropping it is the whole of signing out.
  const logout = useCallback(async () => {
    writeGithubAuthRecord(null);
    clearStoredCredentials();
    setAccount(null);
    setTokenState(null);
  }, [setTokenState]);

  const status: CardStatus = loggingIn ? "loading" : account ? "complete" : "idle";
  const summary = account ? `Signed in as ${account.login}` : "Connect your GitHub account";

  const cardDependencyLabel: string = "Sign in to GitHub";

  return {
    // cardHook
    cardId: "github_login" as const,
    status,
    summary,
    cardDependencyLabel,
    done: status === "complete",
    // loginHook
    account,
    loggingIn,
    login,
    logout,
    refresh: login,
    // extra
    sessionExpired,
    redirecting,
    mode,
    setMode: setModeState,
    backendAvailable: BACKEND_CONFIGURED,
    token,
    setToken: setTokenState,
  };
}
