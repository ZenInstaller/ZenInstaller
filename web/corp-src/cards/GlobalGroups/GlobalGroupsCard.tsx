import { useState } from "react";
import { Autocomplete, Box, Button, Chip, CircularProgress, IconButton, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import UndoIcon from "@mui/icons-material/Undo";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import Card from "../../components/Card";
import RefreshButton from "../../components/RefreshButton";
import { useRefreshIndicator } from "../../hooks/util/useRefreshIndicator";
import type { CardChrome } from "../../types";
import {
  isRowDirty,
  wouldCreateCycle,
  type UseGlobalGroupsCard,
  type GroupRow,
  type GroupRowResult,
} from "./useGlobalGroupsCard";
import { MONO as mono } from "../../config/styles";

function RowStatusIcon({ row, result, dirty }: { row: GroupRow; result: GroupRowResult | undefined; dirty: boolean }) {
  const status = result?.status;
  if (status === "running") return <CircularProgress size={13} sx={{ color: "#2563eb" }} />;
  if (status === "done" || status === "skipped")
    return <CheckCircleOutlineIcon sx={{ fontSize: 15, color: "#22c55e" }} />;
  if (status === "error") return <ErrorOutlineIcon sx={{ fontSize: 15, color: "#ef4444" }} />;
  if (row.isNew && !row.groupName.trim()) return <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: "#cbd5e1" }} />;
  if (dirty) return <RadioButtonCheckedIcon sx={{ fontSize: 14, color: "#d97706" }} />;
  return <CheckCircleOutlineIcon sx={{ fontSize: 15, color: "#94a3b8" }} />;
}

// Invisible until hovered/focused — reads as plain text at rest, becomes an input on interaction.
const ghostFieldSx = (muted: boolean) => ({
  "& .MuiOutlinedInput-root": {
    borderRadius: "4px",
    "& fieldset": { borderColor: "transparent" },
    "&:hover fieldset": { borderColor: "#e2e8f0" },
    "&.Mui-focused fieldset": { borderColor: "#93c5fd" },
    "&.Mui-error fieldset": { borderColor: "#fca5a5" },
  },
  "& .MuiInputBase-input": {
    padding: "1px 4px",
    fontSize: muted ? "0.68rem" : "0.78rem",
    color: muted ? "#94a3b8" : "#0f172a",
    ...(muted ? {} : mono),
  },
});

type Props = {
  card: CardChrome;
  globalGroups: UseGlobalGroupsCard;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      A simple view of this tenant's Entra security groups — edit, create, or delete groups and manage their nesting
      directly.
    </Typography>
  );
}

/*
 * A lightweight Entra security-groups manager: the list mirrors what actually exists in the
 * tenant. Rows with unsynced edits are tinted and get an amber "pending" status circle, the same
 * not-set/pending/synced vocabulary VariablesCard uses for GitHub variables. "Add default
 * groups" offers the same 5-group template ZBCorpArchitecture/corpSetup's c02globalGroups
 * Terraform stage creates, as a starting point.
 */
export default function GlobalGroupsCard({ card, globalGroups }: Props) {
  const {
    rows,
    savedById,
    rowResults,
    rowErrors,
    loading,
    refreshing,
    refresh,
    addRow,
    addDefaultGroups,
    updateRow,
    removeRow,
    revertRow,
    pendingDeleteId,
    requestDeleteRow,
    cancelDeleteRow,
    confirmDeleteRow,
    deleting,
    canSync,
    syncing,
    sync,
    consentRequired,
    requestGroupsConsent,
  } = globalGroups;
  const disabled = card.locked;
  const { refreshResult, markClicked } = useRefreshIndicator(refreshing);
  const [expandedMemberOfId, setExpandedMemberOfId] = useState<string | null>(null);
  // Excludes names that would close a membership cycle (directly or transitively) with this row,
  // so a cyclic parent can't be selected in the first place.
  const memberOfOptions = (row: GroupRow) =>
    rows
      .filter((r) => r.id !== row.id)
      .map((r) => r.groupName)
      .filter((name) => !!name && !wouldCreateCycle(rows, row.groupName, name));

  const handleRefresh = () => {
    markClicked();
    void refresh();
  };

  return (
    <Card title="Global groups" lockedIntro={<Intro />} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
          <Intro />
          <RefreshButton
            busy={refreshing}
            result={refreshResult}
            disabled={disabled || loading}
            onClick={handleRefresh}
          />
        </Box>

        {consentRequired && (
          <Box
            sx={{
              background: "#fef9c3",
              border: "1px solid #fde047",
              borderRadius: "8px",
              px: 2,
              py: 1.25,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
              Additional Microsoft Graph consent is required.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => void requestGroupsConsent()}
              sx={{ textTransform: "none", ...mono, fontSize: "0.7rem", minWidth: 0, px: 1, flexShrink: 0 }}
            >
              Grant consent
            </Button>
          </Box>
        )}

        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <CircularProgress size={12} />
            <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8", ...mono }}>Loading groups from Entra...</Typography>
          </Box>
        )}

        {!loading && rows.length === 0 && (
          <Typography sx={{ fontSize: "0.75rem", color: "#64748b" }}>No groups yet in this tenant.</Typography>
        )}

        {/* Group list */}
        <Box sx={{ border: "1px solid #f1f5f9", borderRadius: "8px", overflow: "hidden" }}>
          {rows.map((row) => {
            const memberOfExpanded = expandedMemberOfId === row.id;
            const dirty = isRowDirty(row, savedById);
            return (
              <Box
                key={row.id}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                  py: 0.75,
                  px: 1.5,
                  borderBottom: "1px solid #f8fafc",
                  background: dirty ? "#fffbeb" : "transparent",
                  transition: "background 0.15s",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <RowStatusIcon row={row} result={rowResults[row.id]} dirty={dirty} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      size="small"
                      variant="outlined"
                      fullWidth
                      placeholder="Group name"
                      value={row.groupName}
                      onChange={(e) => updateRow(row.id, { groupName: e.target.value })}
                      error={!!rowErrors[row.id]}
                      disabled={disabled}
                      sx={ghostFieldSx(false)}
                    />
                    <TextField
                      size="small"
                      variant="outlined"
                      fullWidth
                      placeholder="Description (optional)"
                      value={row.description}
                      onChange={(e) => updateRow(row.id, { description: e.target.value })}
                      disabled={disabled}
                      sx={ghostFieldSx(true)}
                    />
                  </Box>
                  {!memberOfExpanded && (
                    <Box
                      onClick={() => !disabled && setExpandedMemberOfId(row.id)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        flexShrink: 0,
                        cursor: disabled ? "default" : "pointer",
                      }}
                    >
                      {row.memberOfGroupNames.length === 0 ? (
                        <Typography sx={{ fontSize: "0.65rem", color: "#cbd5e1", ...mono }}>no memberships</Typography>
                      ) : (
                        <>
                          <Chip
                            label={row.memberOfGroupNames[0]}
                            size="small"
                            sx={{ height: 18, fontSize: "0.62rem", ...mono }}
                          />
                          {row.memberOfGroupNames.length > 1 && (
                            <Chip
                              label={`+${row.memberOfGroupNames.length - 1}`}
                              size="small"
                              sx={{ height: 18, fontSize: "0.62rem", ...mono }}
                            />
                          )}
                        </>
                      )}
                    </Box>
                  )}
                  {!row.isNew && dirty && (
                    <IconButton
                      size="small"
                      onClick={() => revertRow(row.id)}
                      disabled={disabled}
                      title="Undo changes"
                      sx={{ color: "#cbd5e1", "&:hover": { color: "#d97706" } }}
                    >
                      <UndoIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                  {row.isNew ? (
                    <IconButton
                      size="small"
                      onClick={() => removeRow(row.id)}
                      disabled={disabled}
                      sx={{ color: "#cbd5e1", "&:hover": { color: "#ef4444" } }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  ) : (
                    <IconButton
                      size="small"
                      onClick={() => requestDeleteRow(row.id)}
                      disabled={disabled}
                      sx={{ color: "#cbd5e1", "&:hover": { color: "#ef4444" } }}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  )}
                </Box>

                {memberOfExpanded && (
                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, pl: 3.25 }}>
                    <Autocomplete
                      multiple
                      size="small"
                      openOnFocus
                      options={memberOfOptions(row)}
                      value={row.memberOfGroupNames}
                      onChange={(_, value) => updateRow(row.id, { memberOfGroupNames: value })}
                      disabled={disabled}
                      sx={{ flex: 1 }}
                      renderOption={(props, option) => (
                        <Box component="li" {...props} sx={{ py: 0.75, fontSize: "0.8rem", ...mono }}>
                          {option}
                        </Box>
                      )}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          autoFocus
                          placeholder="Member of..."
                          sx={{ "& .MuiInputBase-input": { fontSize: "0.8rem", ...mono } }}
                        />
                      )}
                    />
                    <Button
                      size="small"
                      onClick={() => setExpandedMemberOfId(null)}
                      sx={{ textTransform: "none", ...mono, fontSize: "0.68rem", color: "#64748b", mt: 0.5 }}
                    >
                      Done
                    </Button>
                  </Box>
                )}

                {rowErrors[row.id] && (
                  <Typography sx={{ fontSize: "0.68rem", color: "#ef4444", pl: 3.25 }}>{rowErrors[row.id]}</Typography>
                )}
                {rowResults[row.id]?.status === "error" && (
                  <Typography sx={{ fontSize: "0.68rem", color: "#ef4444", pl: 3.25 }}>
                    {rowResults[row.id]?.detail}
                  </Typography>
                )}
                {(rowResults[row.id]?.membershipIssues?.length ?? 0) > 0 && (
                  <Typography sx={{ fontSize: "0.68rem", color: "#d97706", pl: 3.25 }}>
                    Membership issues: {rowResults[row.id]?.membershipIssues?.join("; ")}
                  </Typography>
                )}
                {pendingDeleteId === row.id && (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.75,
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "8px",
                      px: 1.5,
                      py: 1,
                    }}
                  >
                    <Typography sx={{ fontSize: "0.72rem", color: "#991b1b" }}>
                      Permanently delete <b>{row.groupName}</b> from Entra ID? This cannot be undone
                      {row.memberOfGroupNames.length > 0 ? " and will also drop its group memberships" : ""}.
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void confirmDeleteRow()}
                        disabled={deleting}
                        startIcon={deleting ? <CircularProgress size={12} sx={{ color: "#fca5a5" }} /> : undefined}
                        sx={{
                          textTransform: "none",
                          ...mono,
                          fontSize: "0.72rem",
                          background: "#dc2626",
                          "&:hover": { background: "#b91c1c" },
                        }}
                      >
                        Delete permanently
                      </Button>
                      <Button
                        size="small"
                        onClick={cancelDeleteRow}
                        disabled={deleting}
                        sx={{ textTransform: "none", ...mono, fontSize: "0.72rem", color: "#64748b" }}
                      >
                        Cancel
                      </Button>
                    </Box>
                  </Box>
                )}
              </Box>
            );
          })}

          {/* Trailing "add a row" affordance — part of the list, not a separate button below it. */}
          <Box
            onClick={disabled ? undefined : addRow}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              py: 0.75,
              px: 1.5,
              cursor: disabled ? "default" : "pointer",
              color: "#94a3b8",
              "&:hover": disabled ? {} : { background: "#f8fafc", color: "#2563eb" },
            }}
          >
            <AddIcon sx={{ fontSize: 14 }} />
            <Typography sx={{ fontSize: "0.72rem", ...mono, color: "inherit" }}>Add group</Typography>
          </Box>
        </Box>

        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}
        >
          <Button
            variant="contained"
            onClick={() => void sync()}
            disabled={disabled || !canSync || syncing}
            startIcon={syncing ? <CircularProgress size={12} sx={{ color: "#93c5fd" }} /> : undefined}
            sx={{
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
              textTransform: "none",
              ...mono,
              fontSize: "0.78rem",
              py: 0.65,
              px: 2,
              borderRadius: "8px",
              "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
              "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
            }}
          >
            Sync groups
          </Button>
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={addDefaultGroups}
            disabled={disabled}
            sx={{
              textTransform: "none",
              ...mono,
              fontSize: "0.72rem",
              color: "#64748b",
              "&:hover": { color: "#2563eb" },
            }}
          >
            Add default groups
          </Button>
        </Box>
      </Box>
    </Card>
  );
}
