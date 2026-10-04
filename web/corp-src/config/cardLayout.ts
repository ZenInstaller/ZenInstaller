/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { MONO as mono } from "./styles";

/*
 * App.tsx's own card-grid layout constants — not reused elsewhere, unlike
 * config/styles.ts's cross-file design tokens.
 */

/*
 * Collapsed cards are a uniform fixed width and wrap 3-per-row; an expanded card
 * spans exactly that 3-card width (3 cards + two 12px gaps) so its right edge lines up.
 */
export const CARD_W = 300;
export const EXPANDED_W = 1280;

/*
 * Viewport width at which 3 collapsed cards + gaps + the outer container's sm+
 * horizontal padding (px:4 = 32px each side) first fit without wrapping.
 */
export const CARD_ROW_BREAKPOINT = EXPANDED_W + 64;

export const groupLabelSx = {
  fontSize: "0.72rem",
  color: "#94a3b8",
  ...mono,
  mt: 3.5,
  mb: 1.25,
  letterSpacing: "0.02em",
  textTransform: "uppercase" as const,
  textAlign: "center" as const,
  [`@media (min-width:${CARD_ROW_BREAKPOINT}px)`]: { textAlign: "left" as const },
};

/*
 * Rows center below CARD_ROW_BREAKPOINT (3 cards can't reliably fit, so any
 * underfull/wrapped row reads as intentional), and left-align at/above it —
 * a group with fewer than 3 cards (e.g. "Sign in") stays left-anchored there
 * since 3 *would* fit, matching the original left-aligned layout.
 */
export const groupSx = {
  display: "flex",
  flexWrap: "wrap",
  mt: 3.5,
  gap: 1.5,
  alignItems: "flex-start",
  justifyContent: "center",
  [`@media (min-width:${CARD_ROW_BREAKPOINT}px)`]: { justifyContent: "flex-start" },
} as const;
