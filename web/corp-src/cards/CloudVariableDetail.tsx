/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { Account } from "../types";
import type { UseGithubVariables } from "../hooks/useGithubVariables";
import VariablesCard from "../components/VariablesCard";
import RefreshButton from "../components/RefreshButton";
import SaveButton from "../components/SaveButton";
import { useVariableEditor } from "../hooks/util/useVariableEditor";
import { useRefreshIndicator } from "../hooks/util/useRefreshIndicator";
import { MONO as mono, sectionLabelSx } from "../config/styles";

type Props = {
  account: Account | null;
  repo: string;
  envName: string | null;
  keys: readonly string[];
  variables: UseGithubVariables;
  populate?: Record<string, string>;
  title?: string;
  disabled?: boolean;
  onComplete?: (done: boolean) => void;
  githubUrl?: string;
  saveHint?: ReactNode; // Rendered next to the Save button (e.g. an "unsaved change" warning).
  keyErrors?: Partial<Record<string, string>>; // Per-key external validation error, shown as a row-level error icon.
  autoSaveCounter?: number; // Increment to auto-apply populate values and immediately save them to GitHub.
  onAutoSaveResult?: (result: "saved" | "no-changes" | "error") => void; // Called when auto-save (triggered by autoSaveCounter) completes.
  onLoaded?: (saved: Record<string, string>) => void;
  onSaved?: (keys: string[]) => void;
};

export default function CloudVariableDetail({
  account,
  repo,
  envName,
  keys,
  variables,
  populate,
  title = "Variables",
  disabled,
  onComplete,
  githubUrl,
  saveHint,
  keyErrors,
  autoSaveCounter,
  onAutoSaveResult,
  onLoaded,
  onSaved,
}: Props) {
  const { refreshResult, markClicked } = useRefreshIndicator(variables.refreshing, variables.error);

  const {
    localValues,
    upsertStatuses,
    updating,
    dirtyKeys,
    onChange: handleChange,
    onRevert: handleRevert,
    onSave,
  } = useVariableEditor({
    keys,
    savedValues: variables.values,
    account,
    repo,
    envName,
    onSavedKey: variables.onConfirmed,
    populate,
    autoSaveCounter,
    onAutoSaveResult,
  });

  const notConfigured = keys.filter((k) => !variables.values[k]).length;

  const complete = keys.every((k) => !!variables.values[k]);
  const scopedValues = Object.fromEntries(keys.map((k) => [k, variables.values[k] ?? ""]));
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);
  useEffect(() => {
    onLoadedRef.current?.(scopedValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(scopedValues)]);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onCompleteRef.current?.(complete);
  }, [complete]);

  const handleRefresh = () => {
    markClicked();
    void variables.onRefresh();
  };
  const handleSave = async () => {
    const result = await onSave();
    if (result.savedKeys.length > 0) onSaved?.(result.savedKeys);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={sectionLabelSx}>{title}</Typography>
          {variables.loading && <CircularProgress size={12} sx={{ color: "#94a3b8" }} />}
          {!variables.loading && notConfigured > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <ErrorOutlineIcon sx={{ fontSize: 12, color: "#ea580c" }} />
              <Typography sx={{ fontSize: "0.65rem", color: "#ea580c" }}>{notConfigured} not configured</Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <RefreshButton
            busy={variables.refreshing}
            result={refreshResult}
            disabled={!account || !repo || !envName || variables.refreshing}
            onClick={handleRefresh}
          />
        </Box>
      </Box>

      <VariablesCard
        requiredKeys={keys}
        savedValues={variables.values}
        localValues={localValues}
        upsertStatuses={upsertStatuses}
        overwriteWarning
        keyErrors={keyErrors}
        onChange={handleChange}
        onRevert={handleRevert}
      />

      <Box
        sx={{
          mt: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SaveButton
            verb="Save"
            noun="variable"
            count={dirtyKeys.length}
            loading={updating}
            disabled={!!disabled || !account || !repo || !envName || updating || dirtyKeys.length === 0}
            onClick={() => void handleSave()}
          />
          {saveHint}
        </Box>
        {githubUrl && (
          <Button
            size="small"
            aria-label="Manage on GitHub"
            endIcon={<OpenInNewIcon sx={{ fontSize: 12 }} />}
            onClick={() => window.open(githubUrl, "_blank")}
            sx={{
              flexShrink: 0,
              fontSize: "0.7rem",
              color: "#64748b",
              textTransform: "none",
              ...mono,
              "&:hover": { color: "#0f172a" },
            }}
          >
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              Manage on GitHub
            </Box>
          </Button>
        )}
      </Box>
    </Box>
  );
}
