/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

/*
 * Shown in place of a card's normal content when a required env var / config
 * value is missing, so the card stays visible instead of silently disappearing.
 */
export default function ConfigErrorNotice() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        px: 1.5,
        py: 1.25,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "8px",
      }}
    >
      <ErrorOutlineIcon sx={{ fontSize: 16, color: "#ef4444", flexShrink: 0, mt: "1px" }} />
      <Typography sx={{ fontSize: "0.78rem", color: "#991b1b", lineHeight: 1.6 }}>
        This card isn't configured correctly and can't be used right now. Contact your administrator.
      </Typography>
    </Box>
  );
}
