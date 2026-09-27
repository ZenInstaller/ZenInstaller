// Matches SESSION_TTL in the remote-login runner, so both sides expire together.
export const REMOTE_TERMINAL_TTL_SECONDS = 1800;

export const TERMINAL_COLS = 120;
export const TERMINAL_ROWS = 24;

export const TERMINAL_COLORS = {
  panel: "#1e1e2e",
  header: "#181825",
  border: "#313244",
  text: "#cdd6f4",
  muted: "#6c7086",
  accent: "#89b4fa",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  red: "#f38ba8",
  // Catppuccin surface1 — the raised state, used for button hovers and the xterm selection alike.
  surface: "#45475a",
  accentHover: "#74a0fc",
  successBg: "#1e3a1e",
} as const;

// The subset xterm takes, derived rather than restated.
export const TERMINAL_THEME = {
  background: TERMINAL_COLORS.panel,
  foreground: TERMINAL_COLORS.text,
  cursor: TERMINAL_COLORS.accent,
  selectionBackground: TERMINAL_COLORS.surface,
} as const;

// The runner names the stages; these are what the card shows for them.
const STAGE_LABELS: Record<string, string> = {
  connecting: "Connecting...",
  "azure-login": "Azure Login",
  "aws-login": "AWS Login",
  "terraform-init": "Terraform Init",
  "terraform-plan": "Terraform Plan",
  done: "Complete",
  error: "Error",
};

// An unknown stage shows as itself rather than blank, so a new runner stage is still readable.
export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}
