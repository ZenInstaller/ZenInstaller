/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Collapse, IconButton, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import BlockIcon from "@mui/icons-material/Block";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { CardStatus, CardChrome } from "../types";
import { MONO as mono } from "../config/styles";
import { CARD_W, EXPANDED_W } from "../config/cardLayout";

const BORDER: Record<CardStatus, string> = {
  idle: "#fed7aa",
  loading: "#e2e8f0",
  complete: "#bbf7d0",
  warning: "#fed7aa",
  error: "#fecaca",
  skipped: "#f1f5f9",
  unavailable: "#e2e8f0",
};

const ICON_COLOR: Record<CardStatus, string> = {
  idle: "#f97316",
  loading: "#60a5fa",
  complete: "#22c55e",
  warning: "#f97316",
  error: "#ef4444",
  skipped: "#94a3b8",
  unavailable: "#cbd5e1",
};

function StatusIcon({ status, locked }: { status: CardStatus; locked: boolean }) {
  /*
   * Same muted grey as the blocked icon - unavailable is styled identically to
   * locked, the glyph is the only thing that tells them apart.
   */
  if (locked) return <BlockIcon sx={{ fontSize: 16, color: "#cbd5e1" }} />;
  const c = ICON_COLOR[status];
  switch (status) {
    case "complete":
      return <CheckCircleIcon sx={{ fontSize: 16, color: c }} />;
    case "unavailable":
    case "warning":
      return <WarningAmberIcon sx={{ fontSize: 15, color: c }} />;
    case "error":
      return <ErrorOutlineIcon sx={{ fontSize: 15, color: c }} />;
    default:
      return <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: c }} />;
  }
}

/*
 * summary: Result value (when complete) or short prompt (when actionable) shown on the card face.
 * locked: Prerequisites unmet - the card still expands, but shows the requirements instead of
 * live content. unavailable: Broken from the start (e.g. missing config), not something to
 * unlock - same muted chrome as `locked` but with a warning icon, and summary/content stay visible.
 */
type Props = CardChrome & {
  title: string;
  action?: React.ReactNode;
  lockedIntro?: React.ReactNode;
  children: React.ReactNode;
};

/*
 * Collapses to a compact summary, expands (accordion) to the full card. Unlike
 * StepWrapper, a locked card still expands — it shows what's missing instead of blocking.
 * Owns its own outer id/width — App just renders <Card {...cardProps(id)} title="…"> directly,
 * no separate wrapping Box.
 */
export default function Card({
  cardId,
  title,
  summary,
  status,
  locked,
  requirements,
  expanded,
  onToggle,
  onRequirementClick,
  action,
  lockedIntro,
  children,
}: Props) {
  /*
   * locked and unavailable share the same muted chrome - the only visual
   * difference between them is the icon (padlock vs warning triangle).
   */
  const muted = locked || status === "unavailable";
  /*
   * Unlike locked, an unavailable card still shows its summary - that IS the
   * "here's what's wrong" message, not a prerequisite result worth hiding.
   */
  const showSummary = !expanded && !!summary && !locked;

  return (
    <Box
      id={`card-${cardId}`}
      sx={{
        boxSizing: "border-box", // width below must include the border, or the 3-collapsed = 1-expanded math in cardLayout.ts drifts by the border's 2px.
        width: expanded ? EXPANDED_W : CARD_W,
        maxWidth: "100%",
        border: "1px solid",
        borderColor: muted ? "#e2e8f0" : BORDER[status],
        borderRadius: "10px",
        background: muted ? "#f8fafc" : "#ffffff",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        transition: "width 0.25s ease, border-color 0.2s, background 0.2s",
        "&:hover": { borderColor: "#93c5fd" },
      }}
    >
      {/*
       * Header (always clickable, even when locked/unavailable) — single flex row so the
       * icon/button always center; a card with no summary is simply shorter, not padded.
       */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          px: 2,
          py: showSummary ? 1.5 : 2,
          cursor: "pointer",
          "&:hover": { background: muted ? "#f1f5f9" : "#fafafa" },
        }}
        onClick={onToggle}
      >
        <StatusIcon status={status} locked={locked} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: muted ? "#94a3b8" : "#0f172a",
              ...mono,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </Typography>
          {showSummary && (
            <Typography
              sx={{
                fontSize: "0.72rem",
                color:
                  status === "unavailable"
                    ? "#64748b"
                    : status === "complete"
                      ? "#16a34a"
                      : status === "warning" || status === "idle"
                        ? "#ea580c"
                        : status === "error"
                          ? "#dc2626"
                          : "#64748b",
                ...mono,
                mt: 0.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {summary}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          {expanded && !muted && action}
          <IconButton size="small" sx={{ color: "#cbd5e1", "&:hover": { color: "#94a3b8" } }}>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
      </Box>

      {/*
       * Content - a locked card can show read-only intro copy, then what's missing,
       * without rendering the unusable interactive content underneath it.
       */}
      <Collapse in={expanded}>
        <Box sx={{ borderTop: "1px solid #f1f5f9", px: 2.5, py: 2.5 }}>
          {locked ? (
            <>
              {lockedIntro && <Box sx={{ mb: 2 }}>{lockedIntro}</Box>}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.75,
                  px: 1.75,
                  py: 1.5,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                }}
              >
                <Typography
                  sx={{
                    fontSize: "0.7rem",
                    color: "#64748b",
                    ...mono,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Complete these first
                </Typography>
                {requirements.map((r) => (
                  <Box
                    key={r.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRequirementClick(r.target);
                    }}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      cursor: "pointer",
                      borderRadius: "6px",
                      px: 0.75,
                      py: 0.4,
                      mx: -0.75,
                      transition: "background 0.15s",
                      "&:hover": { background: "#e0e7ff" },
                      "&:hover .req-label": { textDecoration: "underline" },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 15, color: "#2563eb", flexShrink: 0 }} />
                    <Typography className="req-label" sx={{ fontSize: "0.76rem", color: "#2563eb", fontWeight: 500 }}>
                      {r.label}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            children
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
