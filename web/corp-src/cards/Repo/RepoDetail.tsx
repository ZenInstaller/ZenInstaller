/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useRef, useState } from "react";
import { Box, Button, CircularProgress, Collapse, FormControlLabel, MenuItem, Select, Switch, TextField, Tooltip, Typography } from "@mui/material";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PersonIcon from "@mui/icons-material/Person";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { Account, Repo, RepoOption } from "../../types";
import RefreshButton from "../../components/RefreshButton";
import { useRefreshIndicator } from "../../hooks/util/useRefreshIndicator";

// ─── Template status badge ────────────────────────────────────────────────────

type TemplateStatus = "checking" | "ready" | "not_clone";

const TEMPLATE_STATUS_CONFIG = {
  ready: { label: "Valid", color: "#16a34a", bg: "#f0fdf4", icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
  not_clone: {
    label: "Not a clone",
    color: "#ea580c",
    bg: "#fff7ed",
    icon: <WarningAmberIcon sx={{ fontSize: 14 }} />,
  },
  checking: {
    label: "Checking...",
    color: "#64748b",
    bg: "#f1f5f9",
    icon: <CircularProgress size={12} sx={{ color: "#64748b" }} />,
  },
} as const;

function TemplateBadge({ status }: { status: TemplateStatus }) {
  const cfg = TEMPLATE_STATUS_CONFIG[status];
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.5,
        py: 0.5,
        borderRadius: "6px",
        background: cfg.bg,
        border: `1px solid ${cfg.color}44`,
        color: cfg.color,
        fontSize: "0.72rem",
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.icon}
      {cfg.label}
    </Box>
  );
}

// ─── Shared input style ───────────────────────────────────────────────────────

const inputSx = {
  "& .MuiInputBase-root": {
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: "0.8rem",
    borderRadius: "6px",
  },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#e2e8f0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
  "& .MuiInputBase-input::placeholder": { color: "#94a3b8" },
};

const selectSx = {
  background: "#f8fafc",
  color: "#0f172a",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: "0.8rem",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#e2e8f0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
  "& .MuiSvgIcon-root": { color: "#94a3b8" },
};

const filterOptions = createFilterOptions<RepoOption>();

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  accounts: Account[];
  selectedAccount: Account | null;
  onAccountChange: (account: Account) => void;
  repos: Repo[];
  selectedRepo: RepoOption | null;
  onRepoChange: (repo: RepoOption | null) => void;
  templateStatus: TemplateStatus;
  templateName: string | null;
  defaultTemplateRepo: string;
  isPrivate: boolean;
  onIsPrivateChange: (v: boolean) => void;
  includeAllBranch: boolean;
  onIncludeAllBranchChange: (v: boolean) => void;
  cloning: boolean;
  cloneError: string | null;
  onClone: () => void;
  createEnvs: boolean;
  onCreateEnvsChange: (v: boolean) => void;
  cloneEnvWarning: string | null;
  repoLoading: boolean;
  repoRefreshFailed?: boolean;
  onRefresh: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#64748b" }}>
      We use GitHub repositories to store your custom configuration and settings. That repository will also run GitHub actions to deploy your configuration into
      the target cloud environments. <br />
      Select the GitHub location and type the name of the repository you want to create.
      <br />
    </Typography>
  );
}

export default function RepoDetail({
  accounts,
  selectedAccount,
  onAccountChange,
  repos,
  selectedRepo,
  onRepoChange,
  templateStatus,
  templateName,
  defaultTemplateRepo,
  isPrivate,
  onIsPrivateChange,
  includeAllBranch,
  onIncludeAllBranchChange,
  cloning,
  cloneError,
  onClone,
  createEnvs,
  onCreateEnvsChange,
  cloneEnvWarning,
  repoLoading,
  repoRefreshFailed,
  onRefresh,
}: Props) {
  const isNewRepo = selectedRepo?.isNew ?? false;
  const repoOptions: RepoOption[] = repos.map((r) => ({ id: r.id, name: r.name }));
  const [repoOpen, setRepoOpen] = useState(false);
  // Only set when the user aims at a row with arrows/mouse; MUI stays silent for its own auto-highlight.
  const aimedOption = useRef<RepoOption | null>(null);

  const commitTypedRepo = (typed: string) => {
    const exact = repos.find((r) => r.name.toLowerCase() === typed.toLowerCase());
    onRepoChange(exact ? { id: exact.id, name: exact.name } : { id: `new-${typed}`, name: typed, isNew: true });
    setRepoOpen(false);
  };

  const { refreshResult, markClicked } = useRefreshIndicator(repoLoading, repoRefreshFailed);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* ── Description + Refresh ── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Intro />
        <RefreshButton
          busy={repoLoading}
          result={refreshResult}
          label="Refresh List"
          sx={{ ml: 2 }}
          onClick={() => {
            markClicked();
            onRefresh();
          }}
        />
      </Box>

      {/* ── Selectors row ── */}
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Org selector */}
        <Select
          size="small"
          value={selectedAccount ? String(selectedAccount.id) : ""}
          onChange={(e) => {
            const acc = accounts.find((a) => String(a.id) === e.target.value);
            if (acc) onAccountChange(acc);
          }}
          displayEmpty
          sx={{ minWidth: 180, ...selectSx }}
        >
          {accounts.map((acc) => (
            <MenuItem key={acc.id} value={String(acc.id)} sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem", color: "#0f172a" }}>
              <Box data-sensitive="true" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {acc.type === "User" ? <PersonIcon sx={{ fontSize: 16, color: "#64748b" }} /> : <BusinessIcon sx={{ fontSize: 16, color: "#64748b" }} />}
                {acc.login}
              </Box>
            </MenuItem>
          ))}
        </Select>

        {/* Repo autocomplete */}
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Autocomplete
            value={selectedRepo}
            onChange={(_, newVal) => {
              if (typeof newVal === "string") return;
              onRepoChange(newVal);
            }}
            filterOptions={(options, params) => {
              const typed = params.inputValue.trim();
              const filtered = filterOptions(options, params);
              if (!typed) return filtered;
              // Enter takes the first option: lead with the case-insensitive exact match, or "Clone as..." when there is none.
              const exact = options.find((o) => o.name.toLowerCase() === typed.toLowerCase());
              if (exact) return [exact, ...filtered.filter((o) => o.name !== exact.name)];
              return [{ id: `new-${typed}`, name: typed, isNew: true }, ...filtered];
            }}
            autoHighlight
            open={repoOpen}
            onOpen={() => setRepoOpen(true)}
            onClose={() => setRepoOpen(false)}
            onHighlightChange={(_, option) => {
              aimedOption.current = option;
            }}
            onInputChange={(_, __, reason) => {
              // Typing invalidates an earlier arrow-key aim.
              if (reason === "input") aimedOption.current = null;
            }}
            options={repoOptions}
            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
            isOptionEqualToValue={(o, v) => o.name === v.name}
            renderOption={({ key, ...props }, option) => (
              <Box key={key} component="li" {...props} sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.82rem" }}>
                {option.isNew ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "#2563eb" }}>
                    <AddIcon sx={{ fontSize: 16 }} />
                    Clone as &ldquo;{option.name}&rdquo;
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "#0f172a" }}>
                    <Box sx={{ fontSize: 12, color: "#94a3b8" }}>▪</Box>
                    {option.name}
                  </Box>
                )}
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Select or type repo name..."
                size="small"
                sx={inputSx}
                onKeyDown={(e) => {
                  // A row the user aimed at wins; otherwise Enter decides from the typed text.
                  if (e.key !== "Enter" || aimedOption.current) return;
                  const typed = (e.target as HTMLInputElement).value.trim();
                  if (!typed) return;
                  e.preventDefault();
                  e.stopPropagation();
                  commitTypedRepo(typed);
                }}
              />
            )}
            size="small"
          />
        </Box>
      </Box>

      {/* ── Status row: badge + template name inline ── */}
      {selectedRepo && !isNewRepo && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <TemplateBadge status={templateStatus} />
          {templateName && (
            <>
              <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>origin template:</Typography>
              <Box
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: "4px",
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  fontSize: "0.68rem",
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: "#64748b",
                }}
              >
                {templateName}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* Not a clone warning */}
      {selectedRepo && !isNewRepo && templateStatus === "not_clone" && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 1.5,
            borderRadius: "8px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
          }}
        >
          <WarningAmberIcon sx={{ fontSize: 16, color: "#ea580c", flexShrink: 0 }} />
          <Typography sx={{ fontSize: "0.78rem", color: "#ea580c" }}>
            This repo is not a clone of the template. Only repos cloned from{" "}
            <Box component="span" sx={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
              {defaultTemplateRepo}
            </Box>{" "}
            can be used.
          </Typography>
        </Box>
      )}

      {/* ── Clone panel ── */}
      <Collapse in={isNewRepo} sx={{ display: isNewRepo ? "block" : "none" }}>
        <Box sx={{ p: 2.5, border: "1px solid #bfdbfe", borderRadius: "10px", background: "#eff6ff" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2.5 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>Clone from template</Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "#2563eb", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
              {defaultTemplateRepo}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 4, mb: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={isPrivate}
                  onChange={(e) => onIsPrivateChange(e.target.checked)}
                  size="small"
                  sx={{ "& .Mui-checked + .MuiSwitch-track": { background: "#93c5fd" } }}
                />
              }
              label={<Typography sx={{ fontSize: "0.78rem", color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>Private</Typography>}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={includeAllBranch}
                  onChange={(e) => onIncludeAllBranchChange(e.target.checked)}
                  size="small"
                  sx={{ "& .Mui-checked + .MuiSwitch-track": { background: "#93c5fd" } }}
                />
              }
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography sx={{ fontSize: "0.78rem", color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>Clone all branches</Typography>
                  <Tooltip title="When enabled, all branches from the template will be copied. Otherwise only the default branch is cloned.">
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
                  </Tooltip>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={createEnvs}
                  onChange={(e) => onCreateEnvsChange(e.target.checked)}
                  size="small"
                  sx={{ "& .Mui-checked + .MuiSwitch-track": { background: "#93c5fd" } }}
                />
              }
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography sx={{ fontSize: "0.78rem", color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>Create environments</Typography>
                  <Tooltip title="Automatically creates PROD and TEST GitHub environments in the new repo.">
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
                  </Tooltip>
                </Box>
              }
            />
          </Box>

          {cloneError && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 2,
                p: 1.25,
                borderRadius: "6px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
              }}
            >
              <ErrorOutlineIcon sx={{ fontSize: 15, color: "#ef4444" }} />
              <Typography sx={{ fontSize: "0.75rem", color: "#ef4444" }}>{cloneError}</Typography>
            </Box>
          )}
          {cloneEnvWarning && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 2,
                p: 1.25,
                borderRadius: "6px",
                background: "#fff7ed",
                border: "1px solid #fed7aa",
              }}
            >
              <WarningAmberIcon sx={{ fontSize: 15, color: "#ea580c" }} />
              <Typography sx={{ fontSize: "0.75rem", color: "#ea580c" }}>{cloneEnvWarning}</Typography>
            </Box>
          )}
          <Button
            onClick={onClone}
            disabled={cloning}
            variant="contained"
            size="small"
            sx={{
              background: "#2563eb",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.8rem",
              textTransform: "none",
              py: 0.75,
              px: 2.5,
              "&:hover": { background: "#1d4ed8" },
              "&.Mui-disabled": { background: "#bfdbfe", color: "#93c5fd" },
            }}
          >
            {cloning ? (
              <>
                <CircularProgress size={12} sx={{ mr: 1, color: "#93c5fd" }} />
                Cloning...
              </>
            ) : (
              "Clone Repository"
            )}
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
}
