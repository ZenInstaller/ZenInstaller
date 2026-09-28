import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { UseRemoteTerminal } from "./useRemoteTerminal";
import type { Cloud, TerminalStatus } from "../../logic/remoteTerminal";
import { stageLabel } from "../../config/remoteTerminal";
import { MONO as mono } from "../../config/styles";
import { TERMINAL_COLORS } from "../../config/remoteTerminal";

const STATUS_COLOR: Record<TerminalStatus, string> = {
  idle: TERMINAL_COLORS.muted,
  registering: TERMINAL_COLORS.yellow,
  dispatching: TERMINAL_COLORS.yellow,
  negotiating: TERMINAL_COLORS.yellow,
  connecting: TERMINAL_COLORS.yellow,
  connected: TERMINAL_COLORS.green,
  reconnecting: TERMINAL_COLORS.yellow,
  closed: TERMINAL_COLORS.muted,
  error: TERMINAL_COLORS.red,
};

const IN_PROGRESS: TerminalStatus[] = ["registering", "dispatching", "negotiating", "connecting", "reconnecting"];

const STATUS_TEXT: Record<TerminalStatus, string> = {
  idle: "Idle",
  registering: "Registering the session...",
  dispatching: "Starting the GitHub workflow...",
  negotiating: "Getting a relay token...",
  connecting: "Connecting to the relay...",
  connected: "Connected",
  reconnecting: "Lost the relay — reconnecting...",
  closed: "Session ended",
  error: "Error",
};

const darkBtnSx = {
  background: TERMINAL_COLORS.border,
  color: TERMINAL_COLORS.text,
  border: `1px solid #45475a`,
  ...mono,
  fontSize: "0.7rem",
  textTransform: "none" as const,
  py: 0.4,
  px: 1.25,
  minWidth: 0,
  "&:hover": { background: TERMINAL_COLORS.surface },
};

function StatusBar({ session }: { session: UseRemoteTerminal }) {
  const waitingForRunner = session.status === "connected" && !session.runnerJoined;
  const text = waitingForRunner ? "Connected — waiting for the runner" : STATUS_TEXT[session.status];
  const dotColor = waitingForRunner ? TERMINAL_COLORS.yellow : STATUS_COLOR[session.status];
  const pulsing = waitingForRunner || IN_PROGRESS.includes(session.status);
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.5,
        py: 0.875,
        background: TERMINAL_COLORS.header,
        borderBottom: `1px solid ${TERMINAL_COLORS.border}`,
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          background: dotColor,
          animation: pulsing ? "pulse 1.5s infinite" : "none",
          "@keyframes pulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.3 } },
        }}
      />
      <Typography sx={{ fontSize: "0.72rem", color: TERMINAL_COLORS.text, fontWeight: 600, ...mono }}>
        {text}
      </Typography>
      {session.stage && (
        <Typography
          sx={{
            fontSize: "0.65rem",
            color: TERMINAL_COLORS.accent,
            background: TERMINAL_COLORS.border,
            px: 0.75,
            py: 0.15,
            borderRadius: "4px",
            ...mono,
          }}
        >
          {stageLabel(session.stage)}
        </Typography>
      )}
      {session.sessionId && (
        <Typography sx={{ fontSize: "0.65rem", color: TERMINAL_COLORS.muted, ml: "auto", ...mono }}>
          {session.sessionId.slice(0, 8)}
        </Typography>
      )}
      {/* Gone once the session is over — the panel stays, but there is nothing left to end. */}
      {session.status !== "closed" && session.status !== "idle" && (
        <Button onClick={session.stop} size="small" sx={{ ...darkBtnSx, ml: session.sessionId ? 0 : "auto" }}>
          End session
        </Button>
      )}
    </Box>
  );
}

const CLOUD_NAME: Record<Cloud, string> = { azure: "Azure", aws: "AWS" };

function DeviceCodePanel({ cloud, url, code }: { cloud: Cloud; url: string; code?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <Box
      sx={{
        px: 1.5,
        py: 1.25,
        background: TERMINAL_COLORS.header,
        borderBottom: `1px solid ${TERMINAL_COLORS.border}`,
        textAlign: "center",
      }}
    >
      <Typography sx={{ fontSize: "0.72rem", color: TERMINAL_COLORS.accent, fontWeight: 600, mb: 1, ...mono }}>
        {cloud === "aws" ? "AWS Console Sign-In" : "Azure Device Code Login"}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, flexWrap: "wrap" }}>
        {code && (
          <>
            <Typography
              sx={{
                fontSize: "1.1rem",
                fontWeight: 700,
                letterSpacing: "0.2rem",
                color: TERMINAL_COLORS.yellow,
                background: TERMINAL_COLORS.border,
                px: 1.5,
                py: 0.5,
                borderRadius: "6px",
                ...mono,
              }}
            >
              {code}
            </Typography>
            <Button onClick={handleCopy} size="small" sx={darkBtnSx}>
              {copied ? "Copied!" : "Copy"}
            </Button>
          </>
        )}
        <Button
          href={url}
          target="_blank"
          rel="noopener"
          size="small"
          endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
          sx={{
            ...darkBtnSx,
            background: TERMINAL_COLORS.accent,
            color: TERMINAL_COLORS.panel,
            borderColor: TERMINAL_COLORS.accent,
            "&:hover": { background: TERMINAL_COLORS.accentHover },
          }}
        >
          {cloud === "aws" ? "Open AWS Sign-In" : "Open Microsoft Device Login"}
        </Button>
      </Box>
      <Typography sx={{ fontSize: "0.65rem", color: TERMINAL_COLORS.muted, mt: 1, ...mono }}>
        {cloud === "aws"
          ? "Sign in, then paste the authorization code it gives you into the terminal below."
          : "Enter the code on the Microsoft page — it cannot be pre-filled from the link."}
      </Typography>
    </Box>
  );
}

export default function RemoteTerminal({ session }: { session: UseRemoteTerminal }) {
  const { terminal, resize } = session;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !terminal) return;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(el);
    const refit = () => {
      fit.fit();
      resize(terminal.cols, terminal.rows);
    };
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [terminal, resize]);

  if (!terminal) return null;

  return (
    <Box
      sx={{
        borderRadius: "8px",
        overflow: "hidden",
        border: `1px solid ${TERMINAL_COLORS.border}`,
        background: TERMINAL_COLORS.panel,
      }}
    >
      <StatusBar session={session} />
      {session.deviceCode && (
        <DeviceCodePanel cloud={session.deviceCode.cloud} url={session.deviceCode.url} code={session.deviceCode.code} />
      )}
      {session.loggedIn.length > 0 && (
        <Typography
          sx={{
            fontSize: "0.72rem",
            color: TERMINAL_COLORS.green,
            background: TERMINAL_COLORS.successBg,
            borderBottom: `1px solid ${TERMINAL_COLORS.green}`,
            px: 1.5,
            py: 0.875,
            textAlign: "center",
            ...mono,
          }}
        >
          {session.loggedIn.map((c) => CLOUD_NAME[c]).join(" and ")} sign-in completed.
        </Typography>
      )}
      {session.error && (
        <Typography
          sx={{
            fontSize: "0.7rem",
            color: TERMINAL_COLORS.red,
            px: 1.5,
            py: 0.75,
            borderBottom: `1px solid ${TERMINAL_COLORS.border}`,
            ...mono,
          }}
        >
          {session.error}
        </Typography>
      )}
      <Box ref={containerRef} sx={{ height: "18rem", p: 0.75 }} />
    </Box>
  );
}
