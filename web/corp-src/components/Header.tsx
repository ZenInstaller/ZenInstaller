/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Typography } from "@mui/material";

// The tab title is the same sentence, so it is read from there rather than repeated here.
export default function Header() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: { xs: 2, sm: 4 },
        py: 1.75,
      }}
    >
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: "7px",
          background: "linear-gradient(135deg, #2563eb, #7c3aed)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.7rem",
          fontWeight: 800,
          color: "#fff",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        ZB
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a", letterSpacing: "-0.01em" }}>{document.title}</Typography>
    </Box>
  );
}
