import { fetchWithAuth } from "../../api/backend";
import { REMOTE_TERMINAL_TTL_SECONDS } from "../config/remoteTerminal";
import { ARM_SCOPES } from "../../config/azureConfig";
import type { SessionCredentials } from "../logic/remoteTerminal";

// Temporary: points the terminal endpoints at their own Function App; delete once they share one.
const terminalUrl = import.meta.env.VITE_TERMINAL_API_URL || import.meta.env.VITE_API_URL;

// The relay guards Azure resources, so it checks the Microsoft identity, not the GitHub one.
const MS_AUTHED = { msScopes: ARM_SCOPES };

export async function registerSession({ sessionId, accessToken }: SessionCredentials): Promise<void> {
  const res = await fetchWithAuth(`${terminalUrl}/terminal/register`, {
    ...MS_AUTHED,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, accessToken, ttlSeconds: REMOTE_TERMINAL_TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`Failed to register the terminal session: ${res.status}`);
}

// Returns the Web PubSub client URL, already scoped to this session's group.
export async function negotiateSession({ sessionId, accessToken }: SessionCredentials): Promise<string> {
  const params = new URLSearchParams({ session: sessionId, token: accessToken });
  const res = await fetchWithAuth(`${terminalUrl}/terminal/negotiate?${params}`, { ...MS_AUTHED, method: "POST" });
  if (!res.ok) throw new Error(`Failed to negotiate the terminal session: ${res.status}`);
  const data = await res.json();
  const clientUrl = typeof data.url === "string" ? data.url : data.url?.url;
  if (typeof clientUrl !== "string") throw new Error("Unexpected negotiate response");
  return clientUrl;
}

// Best effort — the session row carries a TTL, so a failure here costs nothing.
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetchWithAuth(`${terminalUrl}/terminal/session/${sessionId}`, { ...MS_AUTHED, method: "DELETE" });
  } catch {
    /* empty */
  }
}
