/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, IconButton, InputAdornment, TextField, Tooltip, Typography } from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import UndoIcon from "@mui/icons-material/Undo";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { UpsertStatus } from "../types";
import { getVariableDisplayName } from "../logic/variables";

// ─── Input style ──────────────────────────────────────────────────────────────

const inputSx = {
  "& .MuiInputBase-root": {
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: "0.78rem",
    borderRadius: "6px",
  },
  "& .MuiInputBase-input": { py: "5px", px: "10px" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#e2e8f0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
  "& .MuiInputBase-input::placeholder": { color: "#94a3b8" },
};

// ─── Variable row ─────────────────────────────────────────────────────────────

function VariableRow({
  varKey,
  savedValue,
  localValue,
  isDirty,
  upsertStatus,
  validStatus,
  description,
  deployedValues,
  overwriteWarning,
  error,
  onChange,
  onRevert,
}: {
  varKey: string;
  savedValue: string | undefined;
  localValue: string;
  isDirty: boolean;
  upsertStatus: UpsertStatus | undefined;
  validStatus?: boolean | null;
  description?: string;
  deployedValues?: Record<string, string>;
  overwriteWarning?: boolean;
  error?: string; // External validation error (e.g. app reg not found in tenant) — independent of upsert/save status.
  onChange: (key: string, value: string) => void;
  onRevert: (key: string) => void;
}) {
  const isSuccess = upsertStatus?.status === "success";
  const isError = upsertStatus?.status === "error" || !!error;
  // Value differs from what was last planned (corp.env snapshot)
  const isDeployedDiff = deployedValues !== undefined && (savedValue ?? "") !== (deployedValues[varKey] ?? "");
  // A pending edit will replace a non-empty value already saved on GitHub
  const willOverwrite = !!overwriteWarning && isDirty && !!savedValue;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 0.875,
        px: 2,
        borderBottom: "1px solid #f8fafc",
        background: isSuccess ? "#f0fdf4" : isError ? "#fef2f2" : isDirty ? "#fffbeb" : "transparent",
        transition: "background 0.2s",
      }}
    >
      {/* Key label + optional info tooltip */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: "10.5rem", flexShrink: 0 }}>
        <Typography
          sx={{
            fontSize: "0.78rem",
            fontFamily: "'IBM Plex Mono', monospace",
            color: isDirty ? "#92400e" : "#0f172a",
            whiteSpace: "nowrap",
          }}
        >
          {getVariableDisplayName(varKey)}
        </Typography>
        {description && (
          <Tooltip title={description} placement="top" arrow>
            <InfoOutlinedIcon sx={{ fontSize: 13, color: "#cbd5e1", cursor: "help", "&:hover": { color: "#94a3b8" } }} />
          </Tooltip>
        )}
      </Box>

      <TextField
        data-sensitive="true"
        size="small"
        placeholder="not set"
        value={localValue}
        onChange={(e) => onChange(varKey, e.target.value)}
        sx={{
          flex: 1,
          ...inputSx,
          ...(isDirty ? { "& .MuiOutlinedInput-notchedOutline": { borderColor: "#fbbf24" } } : {}),
          ...(isError ? { "& .MuiOutlinedInput-notchedOutline": { borderColor: "#ef4444" } } : {}),
        }}
        InputProps={{
          endAdornment:
            localValue || isDirty ? (
              <InputAdornment position="end" sx={{ gap: 0 }}>
                {localValue && (
                  <IconButton size="small" onClick={() => onChange(varKey, "")} sx={{ color: "#94a3b8", p: 0.25, "&:hover": { color: "#475569" } }}>
                    <ClearIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                )}
                {isDirty && (
                  <Tooltip title="Revert to saved value">
                    <IconButton size="small" onClick={() => onRevert(varKey)} sx={{ color: "#94a3b8", p: 0.25, "&:hover": { color: "#d97706" } }}>
                      <UndoIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </InputAdornment>
            ) : undefined,
        }}
      />

      {isDeployedDiff && !isDirty && !isError && (
        <Tooltip title={`Plan configured: ${deployedValues![varKey] || "(empty)"}`} placement="top" arrow>
          <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706", flexShrink: 0 }} />
        </Tooltip>
      )}

      {willOverwrite && !isError && (
        <Tooltip title={`Replaces saved value: ${savedValue}`} placement="top" arrow>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.4,
              px: 0.875,
              py: 0.2,
              borderRadius: "4px",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              fontSize: "0.62rem",
              fontFamily: "'IBM Plex Mono', monospace",
              color: "#b45309",
              flexShrink: 0,
              cursor: "help",
            }}
          >
            <WarningAmberIcon sx={{ fontSize: 10 }} />
            overwrites
          </Box>
        </Tooltip>
      )}

      {isError && (
        <Tooltip title={error ?? upsertStatus?.error ?? "Update failed"}>
          <ErrorOutlineIcon sx={{ fontSize: 14, color: "#ef4444", flexShrink: 0 }} />
        </Tooltip>
      )}

      {isSuccess && (
        <Typography sx={{ fontSize: "0.62rem", color: "#16a34a", fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>just updated</Typography>
      )}

      {!isDirty && !isSuccess && !isError && validStatus === true && (
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.4,
            px: 0.875,
            py: 0.2,
            borderRadius: "4px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            fontSize: "0.62rem",
            fontFamily: "'IBM Plex Mono', monospace",
            color: "#16a34a",
            flexShrink: 0,
          }}
        >
          <CheckCircleIcon sx={{ fontSize: 10 }} />
          valid
        </Box>
      )}

      {!isDirty && !isSuccess && !isError && validStatus === false && (
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.4,
            px: 0.875,
            py: 0.2,
            borderRadius: "4px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            fontSize: "0.62rem",
            fontFamily: "'IBM Plex Mono', monospace",
            color: "#ef4444",
            flexShrink: 0,
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 10 }} />
          invalid
        </Box>
      )}
    </Box>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  requiredKeys: readonly string[];
  savedValues: Record<string, string>;
  localValues: Record<string, string>;
  upsertStatuses: UpsertStatus[];
  validStatus?: boolean | null;
  descriptions?: Partial<Record<string, string>>; // Optional per-key hint shown as a tooltip on the ⓘ icon
  deployedValues?: Record<string, string>; // Values from the last deployed corp.env snapshot — used to highlight changed rows
  overwriteWarning?: boolean; // When true, dirty rows that replace a non-empty saved value show an "overwrites" warning
  keyErrors?: Partial<Record<string, string>>; // Per-key external validation error (e.g. app reg not found in tenant)
  onChange: (key: string, value: string) => void;
  onRevert: (key: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function VariablesCard({
  requiredKeys,
  savedValues,
  localValues,
  upsertStatuses,
  validStatus,
  descriptions,
  deployedValues,
  overwriteWarning,
  keyErrors,
  onChange,
  onRevert,
}: Props) {
  return (
    <Box sx={{ border: "1px solid #f1f5f9", borderRadius: "8px", overflow: "hidden" }}>
      {requiredKeys.map((key) => (
        <VariableRow
          key={key}
          varKey={key}
          savedValue={savedValues[key]}
          localValue={localValues[key] ?? ""}
          isDirty={(localValues[key] ?? "") !== (savedValues[key] ?? "")}
          upsertStatus={upsertStatuses.find((s) => s.key === key)}
          validStatus={validStatus}
          description={descriptions?.[key]}
          deployedValues={deployedValues}
          overwriteWarning={overwriteWarning}
          error={keyErrors?.[key]}
          onChange={onChange}
          onRevert={onRevert}
        />
      ))}
    </Box>
  );
}
