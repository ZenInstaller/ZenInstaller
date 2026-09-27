import { toHex } from "../../logic/crypto";

export type SessionCredentials = { sessionId: string; accessToken: string };

// The browser owns the credentials so the access token never travels as a workflow input.
export function createSessionCredentials(): SessionCredentials {
  return {
    sessionId: crypto.randomUUID(),
    accessToken: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
}

// What the remote-login runner sends into the session group.
export type Cloud = "azure" | "aws";

export type RunnerMessage =
  | { type: "terminal"; data: string }
  // AWS hands the code back through the console, so only Azure carries one up front.
  | { type: "deviceCode"; cloud: Cloud; url: string; code?: string }
  | { type: "loginCompleted"; cloud: Cloud }
  | { type: "loginFailed"; cloud: Cloud; exitCode: number }
  | { type: "stage"; stage: string }
  // The runner is about to hang up on purpose — not a dropout to reconnect through.
  | { type: "sessionClosed"; ok: boolean }
  | { type: "terraformCompleted" }
  | { type: "terraformFailed"; exitCode: number };

export type SocketEvent =
  { kind: "connected" } | { kind: "ack"; success: boolean } | { kind: "runner"; message: RunnerMessage };

/*
 * The four in-progress states are separate because each fails for a different reason: CORS on the
 * backend, GitHub permissions on the dispatch, a backend 500 on the token, and the relay itself.
 * One combined "starting" made all four look identical while you waited.
 */
export type TerminalStatus =
  | "idle"
  | "registering"
  | "dispatching"
  | "negotiating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "error";

function asRunnerMessage(payload: unknown): RunnerMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const type = (payload as { type?: unknown }).type;
  switch (type) {
    case "terminal":
    case "deviceCode":
    case "loginCompleted":
    case "loginFailed":
    case "stage":
    case "sessionClosed":
    case "terraformCompleted":
    case "terraformFailed":
      return payload as RunnerMessage;
    default:
      return null;
  }
}

// Unwraps a Web PubSub JSON-protocol frame; null means it is not something this session acts on.
export function parseSocketEvent(raw: string, sessionId: string): SocketEvent | null {
  let frame: Record<string, unknown>;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }

  if (frame.type === "system" && frame.event === "connected") return { kind: "connected" };
  if (frame.type === "ack") return { kind: "ack", success: frame.success === true };
  if (frame.type !== "message" || frame.group !== sessionId) return null;

  const data = frame.data;
  if (typeof data !== "string") {
    const message = asRunnerMessage(data);
    return message ? { kind: "runner", message } : null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    // Not JSON, so the runner streamed raw terminal bytes.
    return { kind: "runner", message: { type: "terminal", data } };
  }
  const message = asRunnerMessage(payload);
  return message ? { kind: "runner", message } : null;
}
