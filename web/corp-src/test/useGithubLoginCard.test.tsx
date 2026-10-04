/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearGithubToken } from "../cards/GithubLogin/useGithubLoginCard";
import { readGithubAuthRecord, useGithubLoginCard, type UseGithubLoginCard } from "../cards/GithubLogin/useGithubLoginCard";

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    verifyAuth: vi.fn(),
    switchToDirect: vi.fn(),
    switchToBackend: vi.fn(),
    backendLogout: vi.fn(),
    fetchGithubUser: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  verifyAuth: apiMocks.verifyAuth,
  switchToDirect: apiMocks.switchToDirect,
  switchToBackend: apiMocks.switchToBackend,
  logout: apiMocks.backendLogout,
  fetchGithubUser: apiMocks.fetchGithubUser,
}));

// jsdom refuses real navigation, so the redirect is captured instead of followed.
const navigations: string[] = [];
beforeEach(() => {
  navigations.length = 0;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "http://localhost",
      pathname: "/",
      search: "",
      href: "http://localhost/",
      replace: (u: string) => navigations.push(u),
    },
  });
  Object.defineProperty(window.location, "href", {
    configurable: true,
    get: () => "http://localhost/",
    set: (u: string) => navigations.push(u),
  });
});

function HookHarness(props: { onUpdate: (value: UseGithubLoginCard) => void }) {
  const value = useGithubLoginCard();

  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);

  return null;
}

async function waitFor(assertion: () => void, timeoutMs = 1500) {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}

describe("useGithubLoginCard", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    sessionStorage.clear();
    // The live token is a module variable, so clearing storage alone leaks it between tests.
    clearGithubToken();
    apiMocks.verifyAuth.mockResolvedValue({ login: "octocat" });
  });

  it("starts idle when no auth record is saved", async () => {
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(apiMocks.verifyAuth).not.toHaveBeenCalled();
      expect(latest?.loggingIn).toBe(false);
      expect(latest?.account).toBeNull();
      expect(latest?.status).toBe("idle");
      expect(latest?.summary).toBe("Connect your GitHub account");
      expect(latest?.cardId).toBe("github_login");
      expect(latest?.cardDependencyLabel).toBe("Sign in to GitHub");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("returns null when auth record JSON is invalid", () => {
    sessionStorage.setItem("zeninstaller_github_auth", "{not-valid-json");
    expect(readGithubAuthRecord()).toBeNull();
  });

  it("treats invalid saved auth record as missing and stays idle", async () => {
    sessionStorage.setItem("zeninstaller_github_auth", "{not-valid-json");

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(apiMocks.verifyAuth).not.toHaveBeenCalled();
      expect(latest?.status).toBe("idle");
      expect(latest?.loggingIn).toBe(false);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("restores backend auth from session storage on mount", async () => {
    sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "backend" }));
    sessionStorage.setItem("github_access_token", "gho_restored");

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      // The browser holds the token, but backend mode still spends it through the proxy.
      expect(apiMocks.switchToBackend).toHaveBeenCalledTimes(1);
      expect(apiMocks.switchToDirect).not.toHaveBeenCalled();
      expect(apiMocks.verifyAuth).toHaveBeenCalledTimes(1);
      expect(latest?.mode).toBe("backend");
      expect(latest?.account?.login).toBe("octocat");
      expect(latest?.status).toBe("complete");
      expect(latest?.done).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("restores direct auth and switches the API into direct mode", async () => {
    sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "direct", token: "ghp_saved" }));

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(apiMocks.switchToDirect).toHaveBeenCalledWith("ghp_saved");
      expect(apiMocks.verifyAuth).toHaveBeenCalledTimes(1);
      expect(latest?.mode).toBe("direct");
      expect(latest?.token).toBe("ghp_saved");
      expect(latest?.account?.login).toBe("octocat");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves session record and marks expired when mount auth verification fails", async () => {
    sessionStorage.setItem("github_access_token", "gho_restored");
    sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "backend" }));
    apiMocks.verifyAuth.mockRejectedValueOnce(new Error("expired"));

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
      expect(latest?.account).toBeNull();
      expect(JSON.parse(sessionStorage.getItem("zeninstaller_github_auth") ?? "null")).toEqual({ mode: "backend" });
      expect(latest?.sessionExpired).toBe(true);
      expect(latest?.status).toBe("idle");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("sends the user to GitHub and keeps the PKCE verifier for the callback", async () => {
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
    });

    await act(async () => {
      await latest!.login();
    });

    await waitFor(() => {
      expect(navigations.some((u) => u.startsWith("https://github.com/login/oauth/authorize"))).toBe(true);
      // The verifier has to survive the redirect or the exchange cannot prove anything.
      expect(sessionStorage.getItem("github_pkce_verifier")).toBeTruthy();
      expect(latest?.redirecting).toBe("login");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves direct token when setting direct mode again", async () => {
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
    });

    await act(async () => {
      latest?.setMode("direct");
      latest?.setToken("ghp_keep_me");
      latest?.setMode("direct");
    });

    await act(async () => {
      await latest!.login();
    });

    await waitFor(() => {
      expect(apiMocks.switchToDirect).toHaveBeenCalledWith("ghp_keep_me");
      expect(JSON.parse(sessionStorage.getItem("zeninstaller_github_auth") ?? "null")).toEqual({
        mode: "direct",
        token: "ghp_keep_me",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not login in direct mode when token is missing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
    });

    apiMocks.verifyAuth.mockClear();
    await act(async () => {
      latest?.setMode("direct");
      latest?.setToken(null);
      await latest?.login();
    });

    expect(consoleError).toHaveBeenCalledWith("Missing PAT");
    expect(apiMocks.switchToDirect).not.toHaveBeenCalled();
    expect(apiMocks.verifyAuth).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("spends the code the OAuth return stashed, and signs in as that user", async () => {
    sessionStorage.setItem("github_pkce_verifier", "the-verifier");
    // What captureOAuthReturn leaves behind when the page loads back from GitHub.
    sessionStorage.setItem("oauth_pending_code", "abc123");
    sessionStorage.setItem("oauth_pending_provider", "github");
    // exchangeToken posts to our own backend; nothing else in this test hits the network.
    const exchange = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "gho_exchanged" }),
    });
    vi.stubGlobal("fetch", exchange);
    apiMocks.fetchGithubUser.mockResolvedValueOnce({ login: "octocat" });

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      const body = JSON.parse(exchange.mock.calls[0]?.[1]?.body ?? "{}");
      expect(body.code).toBe("abc123");
      expect(body.code_verifier).toBe("the-verifier");
      expect(body.redirect_uri).toBe("http://localhost");
      expect(sessionStorage.getItem("github_access_token")).toBe("gho_exchanged");
      // Both spent, and useless to anyone who finds them later.
      expect(sessionStorage.getItem("github_pkce_verifier")).toBeNull();
      expect(sessionStorage.getItem("oauth_pending_code")).toBeNull();
      expect(apiMocks.switchToBackend).toHaveBeenCalledTimes(1);
      expect(latest?.account?.login).toBe("octocat");
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("switches to direct mode, stores the token, and clears it on logout", async () => {
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
    });

    await act(async () => {
      latest?.setMode("direct");
      latest?.setToken("ghp_live_token");
    });

    await act(async () => {
      await latest!.login();
    });

    await waitFor(() => {
      expect(apiMocks.switchToDirect).toHaveBeenCalledWith("ghp_live_token");
      expect(latest?.mode).toBe("direct");
      expect(latest?.token).toBe("ghp_live_token");
      expect(JSON.parse(sessionStorage.getItem("zeninstaller_github_auth") ?? "null")).toEqual({
        mode: "direct",
        token: "ghp_live_token",
      });
    });

    await act(async () => {
      await latest!.logout();
    });

    await waitFor(() => {
      expect(apiMocks.backendLogout).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("zeninstaller_github_auth")).toBeNull();
      expect(latest?.account).toBeNull();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("clears every stored credential on logout", async () => {
    sessionStorage.setItem("github_access_token", "gho_live");
    sessionStorage.setItem("github_pat_token", "ghp_live");
    sessionStorage.setItem("github_pkce_verifier", "left-over");

    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
    });

    await act(async () => {
      await latest?.logout();
    });

    // Signing out is entirely local now, so anything left behind is a token someone could reuse.
    expect(sessionStorage.getItem("github_access_token")).toBeNull();
    expect(sessionStorage.getItem("github_pat_token")).toBeNull();
    expect(sessionStorage.getItem("github_pkce_verifier")).toBeNull();
    expect(sessionStorage.getItem("zeninstaller_github_auth")).toBeNull();
    expect(sessionStorage.getItem("github_login")).toBeNull();
    expect(latest?.account).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("marks sessionExpired when the session-expired event fires", async () => {
    let latest: UseGithubLoginCard | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await waitFor(() => {
      expect(latest?.loggingIn).toBe(false);
      expect(latest?.sessionExpired).toBe(false);
    });

    await act(async () => {
      window.dispatchEvent(new Event("auth:session-expired"));
    });

    await waitFor(() => {
      expect(latest?.sessionExpired).toBe(true);
    });

    await act(async () => {
      root.unmount();
    });
  });
});
