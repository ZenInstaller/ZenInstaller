/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

/*
 * Shared UI style tokens for the corp installer, pulled out of the ~12 card/
 * component files that each redeclared their own identical copies.
 */

// IBM Plex Mono font family — by far the most-repeated inline style in corp-src.
export const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const;

// Slim "Refresh" text button used by every card that re-fetches remote state.
export const refreshBtnSx = {
  flexShrink: 0,
  color: "#94a3b8",
  fontSize: "0.72rem",
  textTransform: "none" as const,
  ...MONO,
  "&:hover": { color: "#475569" },
};

// Small uppercase field label used by the Azure / domain / terraform setup cards.
export const labelSx = {
  fontSize: "0.68rem",
  color: "#94a3b8",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  ...MONO,
};

/*
 * Uppercase section heading. Defaults to the dark (#0f172a) variant;
 * EnvSecretsDetail overrides `color` to the muted #94a3b8.
 */
export const sectionLabelSx = {
  fontSize: "0.7rem",
  fontWeight: 700,
  color: "#0f172a",
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
  ...MONO,
};
