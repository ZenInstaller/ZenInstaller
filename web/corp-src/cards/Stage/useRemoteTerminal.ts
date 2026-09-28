import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { triggerRemoteLogin } from "../../api";
import { deleteSession, negotiateSession, registerSession } from "../../api/backend";
import { TERMINAL_COLS, TERMINAL_ROWS, TERMINAL_THEME } from "../../config/remoteTerminal";
import { createSessionCredentials, parseSocketEvent } from "../../logic/remoteTerminal";
import type { Cloud, RunnerMessage, SessionCredentials, TerminalStatus } from "../../logic/remoteTerminal";
import type { Account, GhEnv } from "../../types";

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

export type DeviceCode = { cloud: Cloud; url: string; code?: string };

export interface UseRemoteTerminal {
  terminal: Terminal | null;
  status: TerminalStatus;
  sessionId: string | null;
  stage: string | null;
  deviceCode: DeviceCode | null;
  loggedIn: Cloud[];
  runnerJoined: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => void;
  resize: (cols: number, rows: number) => void;
}

export function useRemoteTerminal(opts: {
  account: Account | null;
  repoName: string;
  workflowId: string;
  dir: string;
  planRunId: string | undefined;
  selectedEnv: GhEnv | null;
}): UseRemoteTerminal {
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);
  const [loggedIn, setLoggedIn] = useState<Cloud[]>([]);
  const [runnerJoined, setRunnerJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const credsRef = useRef<SessionCredentials | null>(null);
  const stoppedRef = useRef(true);
  const joinedRef = useRef(false);
  const attemptsRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<() => Promise<void>>(async () => {});

  const sendToGroup = useCallback((payload: object) => {
    const ws = wsRef.current;
    const creds = credsRef.current;
    if (!ws || !creds || ws.readyState !== WebSocket.OPEN || !joinedRef.current) return;
    ws.send(
      JSON.stringify({
        type: "sendToGroup",
        group: creds.sessionId,
        dataType: "text",
        noEcho: true,
        data: JSON.stringify(payload),
      }),
    );
  }, []);

  const resize = useCallback(
    (cols: number, rows: number) => sendToGroup({ type: "resize", cols, rows }),
    [sendToGroup],
  );

  const closeSocket = useCallback((delayMs = 0) => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (delayMs > 0) setTimeout(() => ws.close(), delayMs);
    else ws.close();
  }, []);

  // Shared by both exits: stop reconnecting, drop the socket, and forget the session server-side.
  const disconnect = useCallback(
    (closeDelayMs: number) => {
      stoppedRef.current = true;
      joinedRef.current = false;
      attemptsRef.current = 0;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      closeSocket(closeDelayMs);
      const creds = credsRef.current;
      credsRef.current = null;
      if (creds) void deleteSession(creds.sessionId);
    },
    [closeSocket],
  );

  // A closed session's terminal is a transcript, not a prompt. Leaving the cursor blinking invites
  // typing that has nowhere to go, since sendToGroup is a no-op once the socket is down.
  const freezeTerminal = () => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorBlink = false;
    term.options.disableStdin = true;
  };

  /*
   * Full teardown, including the xterm instance. Only for the two cases where this session is
   * genuinely being replaced or thrown away — a new start(), or the card unmounting — since
   * leaving a Terminal behind either way would leak it.
   */
  const teardown = useCallback(() => {
    disconnect(0);
    termRef.current?.dispose();
    termRef.current = null;
    setTerminal(null);
    setStatus("idle");
    setSessionId(null);
    setStage(null);
    setDeviceCode(null);
    setLoggedIn([]);
    setRunnerJoined(false);
    setError(null);
  }, [disconnect]);

  /*
   * The End session button. Hangs up but leaves the transcript on screen — the output is the record
   * of what happened. The terminal stays mounted and effectively read-only: sendToGroup checks
   * joinedRef, so keystrokes have nowhere to go once the socket is down.
   */
  const stop = useCallback(() => {
    if (stoppedRef.current) return;
    sendToGroup({ type: "endSession" });
    // Delayed so the frame above leaves before the socket does.
    disconnect(250);
    freezeTerminal();
    setStatus("closed");
    setDeviceCode(null);
  }, [disconnect, sendToGroup]);

  const handleRunnerMessage = (message: RunnerMessage) => {
    setRunnerJoined(true);
    switch (message.type) {
      case "terminal":
        termRef.current?.write(message.data);
        break;
      case "deviceCode":
        setDeviceCode({ cloud: message.cloud, url: message.url, code: message.code });
        break;
      case "loginCompleted":
        setLoggedIn((prev) => (prev.includes(message.cloud) ? prev : [...prev, message.cloud]));
        setDeviceCode(null);
        break;
      case "loginFailed":
        setError(`${message.cloud === "aws" ? "AWS" : "Azure"} login failed (exit ${message.exitCode})`);
        setStage("error");
        break;
      case "stage":
        setStage(message.stage);
        break;
      case "sessionClosed":
        stoppedRef.current = true;
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        freezeTerminal();
        setStatus(message.ok ? "closed" : "error");
        setDeviceCode(null);
        break;
      case "terraformCompleted":
        setStage("done");
        break;
      case "terraformFailed":
        setError(`Terraform failed (exit ${message.exitCode})`);
        setStage("error");
        break;
    }
  };

  const scheduleReconnect = () => {
    if (stoppedRef.current) return;
    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus("error");
      setError("Lost the terminal connection. Deploy again to start a new session.");
      return;
    }
    attemptsRef.current += 1;
    setStatus("reconnecting");
    const delay = Math.min(RECONNECT_BASE_MS * attemptsRef.current, RECONNECT_MAX_MS);
    reconnectTimer.current = setTimeout(() => void connectRef.current(), delay);
  };

  const connect = async () => {
    const creds = credsRef.current;
    if (!creds || stoppedRef.current) return;

    setStatus("negotiating");
    let clientUrl: string;
    try {
      clientUrl = await negotiateSession(creds);
    } catch (e) {
      console.error("Failed to negotiate the terminal session:", e);
      scheduleReconnect();
      return;
    }
    if (stoppedRef.current) return;

    setStatus("connecting");
    const ws = new WebSocket(clientUrl, "json.webpubsub.azure.v1");
    wsRef.current = ws;
    joinedRef.current = false;

    ws.onmessage = (event) => {
      const parsed = parseSocketEvent(String(event.data), creds.sessionId);
      if (!parsed) return;
      if (parsed.kind === "connected") {
        ws.send(JSON.stringify({ type: "joinGroup", group: creds.sessionId, ackId: 1 }));
        return;
      }
      if (parsed.kind === "ack") {
        if (!parsed.success) {
          setStatus("error");
          setError("Could not join the terminal session");
          return;
        }
        joinedRef.current = true;
        attemptsRef.current = 0;
        setStatus("connected");
        setError(null);
        const term = termRef.current;
        sendToGroup({ type: "resize", cols: term?.cols ?? TERMINAL_COLS, rows: term?.rows ?? TERMINAL_ROWS });
        return;
      }
      handleRunnerMessage(parsed.message);
    };

    ws.onerror = () => setError("Terminal connection error");
    ws.onclose = () => {
      joinedRef.current = false;
      if (wsRef.current === ws) wsRef.current = null;
      scheduleReconnect();
    };
  };
  useLayoutEffect(() => {
    connectRef.current = connect;
  });

  const start = useCallback(async (): Promise<boolean> => {
    const { account, repoName, workflowId, dir, planRunId, selectedEnv } = optsRef.current;
    if (!account || !repoName || !selectedEnv || !planRunId) return false;

    teardown();
    setStatus("registering");

    const term = new Terminal({
      cols: TERMINAL_COLS,
      rows: TERMINAL_ROWS,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    term.onData((data) => sendToGroup({ type: "input", data }));
    termRef.current = term;
    setTerminal(term);

    const creds = createSessionCredentials();
    credsRef.current = creds;
    stoppedRef.current = false;
    setSessionId(creds.sessionId);

    try {
      await registerSession(creds);
      setStatus("dispatching");
      // await triggerRemoteLogin(account, repoName, {
      //   workflowId,
      //   githubEnvName: selectedEnv.name,
      //   ref: selectedEnv.name,
      //   sessionId: creds.sessionId,
      //   dir,
      //   planRunId,
      // });
    } catch (e) {
      console.error("Failed to start the remote login session:", e);
      setStatus("error");
      setError(e instanceof Error ? e.message : "Failed to start the remote login session");
      return false;
    }

    await connectRef.current();
    return true;
  }, [sendToGroup, teardown]);

  useEffect(() => teardown, [teardown]);

  return { terminal, status, sessionId, stage, deviceCode, loggedIn, runnerJoined, error, start, stop, resize };
}
