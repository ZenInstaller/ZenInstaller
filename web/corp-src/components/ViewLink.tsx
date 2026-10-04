/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Button } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { MONO as mono } from "../config/styles";

type Props = {
  href: string;
  label?: string;
};

export default function ViewLink({ href, label = "View" }: Props) {
  return (
    <Button
      size="small"
      variant="outlined"
      aria-label={label}
      endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
      // The card header toggles collapse on click, so this must not bubble.
      onClick={(e) => {
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      sx={{
        flexShrink: 0,
        borderColor: "#e2e8f0",
        color: "#475569",
        fontSize: "0.72rem",
        textTransform: "none",
        ...mono,
        "&:hover": { borderColor: "#cbd5e1", color: "#0f172a", background: "#f8fafc" },
      }}
    >
      <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
        {label}
      </Box>
    </Button>
  );
}
