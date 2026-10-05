/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import { refreshBtnSx } from "../config/styles";
import type { RefreshResult } from "../hooks/util/useRefreshIndicator";

type Props = {
  busy: boolean;
  result: RefreshResult;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
};

/*
 * The slim "Refresh / Done / Failed" button used by every card that re-fetches
 * remote state. Pair with useRefreshIndicator for the transient result state.
 */
export default function RefreshButton({ busy, result, onClick, label = "Refresh", disabled, sx }: Props) {
  const text = result === "done" ? "Done" : result === "failed" ? "Failed" : label;
  return (
    <Button
      size="small"
      onClick={onClick}
      disabled={disabled ?? busy}
      aria-label={text}
      startIcon={
        busy ? (
          <CircularProgress size={12} sx={{ color: "#94a3b8" }} />
        ) : result === "done" ? (
          <CheckIcon sx={{ fontSize: 14 }} />
        ) : result === "failed" ? (
          <ErrorOutlineIcon sx={{ fontSize: 14 }} />
        ) : (
          <RefreshIcon sx={{ fontSize: 14 }} />
        )
      }
      sx={{
        ...refreshBtnSx,
        ...(result && {
          color: result === "done" ? "#22c55e" : "#ef4444",
          "&:hover": { color: result === "done" ? "#16a34a" : "#b91c1c" },
          transition: "color 0.15s",
        }),
        ...sx,
      }}
    >
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        {text}
      </Box>
    </Button>
  );
}
