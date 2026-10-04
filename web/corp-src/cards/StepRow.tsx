/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, CircularProgress, LinearProgress, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import type { SetupStep } from "../types";
import { MONO as mono } from "../config/styles";

// One row of the progress checklist the AzureConfigHook cards render while run() executes.
export default function StepRow({ step }: { step: SetupStep }) {
  const icon =
    step.status === "done" ? (
      <CheckCircleOutlineIcon sx={{ fontSize: 14, color: "#22c55e" }} />
    ) : step.status === "skipped" ? (
      <RemoveCircleOutlineIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
    ) : step.status === "error" ? (
      <ErrorOutlineIcon sx={{ fontSize: 14, color: "#ef4444" }} />
    ) : step.status === "running" ? (
      <CircularProgress size={12} sx={{ color: "#2563eb" }} />
    ) : (
      <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: "#cbd5e1" }} />
    );

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "18px 1fr", alignItems: "start", py: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", height: "1.2em" }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: "0.78rem", color: step.status === "error" ? "#ef4444" : "#475569", ...mono }}>{step.label}</Typography>
        {step.detail && (
          <Typography data-sensitive="true" sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono, mt: 0.25, wordBreak: "break-all" }}>
            {step.detail}
          </Typography>
        )}
        {step.progress != null && step.status === "running" && (
          <LinearProgress
            variant="determinate"
            value={Math.min(100, Math.max(0, step.progress * 100))}
            sx={{
              mt: 0.5,
              height: 4,
              borderRadius: 2,
              background: "#e2e8f0",
              "& .MuiLinearProgress-bar": { background: "#2563eb", borderRadius: 2 },
            }}
          />
        )}
      </Box>
    </Box>
  );
}
