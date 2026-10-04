/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Alert, Box, CircularProgress } from "@mui/material";

type Props = {
  loading: boolean;
  warnings: string[];
  onDismiss: () => void;
};

export default function RestoreToast({ loading, warnings, onDismiss }: Props) {
  if (!loading && warnings.length === 0) return null;
  return (
    <Box
      sx={{
        position: "fixed",
        top: "75px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1400,
        minWidth: 300,
        maxWidth: 480,
        width: "max-content",
      }}
    >
      {loading && (
        <Alert
          severity="info"
          icon={<CircularProgress size={16} sx={{ color: "#2563eb" }} />}
          sx={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.78rem",
            alignItems: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            borderRadius: "10px",
          }}
        >
          Restoring settings
        </Alert>
      )}
      {!loading && warnings.length > 0 && (
        <Alert
          severity="warning"
          onClose={onDismiss}
          sx={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.78rem",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            borderRadius: "10px",
          }}
        >
          {warnings.length === 1 ? (
            warnings[0]
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {warnings.map((w, i) => (
                <Box key={i}>{w}</Box>
              ))}
            </Box>
          )}
        </Alert>
      )}
    </Box>
  );
}
