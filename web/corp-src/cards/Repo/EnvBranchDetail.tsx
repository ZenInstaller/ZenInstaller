import { Box, Button, CircularProgress, MenuItem, Select, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { Branch } from "../../types";

const selectSx = {
  background: "#f8fafc",
  color: "#0f172a",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: "0.8rem",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#e2e8f0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
  "& .MuiSvgIcon-root": { color: "#94a3b8" },
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  targetBranch: string; // The branch name to create — derived from the selected environment name.
  branches: Branch[];
  sourceBranch: string;
  onSourceBranchChange: (v: string) => void;
  creatingBranch: boolean;
  createBranchError: string | null;
  onCreateBranch: (target: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnvBranchDetail({
  targetBranch,
  branches,
  sourceBranch,
  onSourceBranchChange,
  creatingBranch,
  createBranchError,
  onCreateBranch,
}: Props) {
  return (
    <Box sx={{ p: 2.5, mt: 1.5, border: "1px solid #bfdbfe", borderRadius: "10px", background: "#eff6ff" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        {/* Create button */}
        <Button
          onClick={() => onCreateBranch(targetBranch)}
          disabled={creatingBranch || !sourceBranch}
          variant="contained"
          size="small"
          startIcon={creatingBranch ? <CircularProgress size={12} sx={{ color: "#93c5fd" }} /> : <AddIcon />}
          sx={{
            background: "#2563eb",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "0.8rem",
            textTransform: "none",
            py: 0.75,
            px: 2,
            "&:hover": { background: "#1d4ed8" },
            "&.Mui-disabled": { background: "#bfdbfe", color: "#93c5fd" },
          }}
        >
          Create New Branch: {targetBranch}
        </Button>

        <>
          <Typography
            sx={{ fontSize: "0.72rem", color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0 }}
          >
            Clone the new branch from existing branch:
          </Typography>
          <Select
            size="small"
            value={sourceBranch}
            onChange={(e) => onSourceBranchChange(e.target.value)}
            sx={{ mr: 3, minWidth: 140, ...selectSx }}
          >
            {branches.map((b) => (
              <MenuItem
                key={b.name}
                value={b.name}
                sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <CallSplitIcon sx={{ fontSize: 13, color: "#94a3b8" }} />
                  {b.name}
                  {b.protected && (
                    <Box component="span" sx={{ fontSize: "0.62rem", color: "#f97316", ml: 0.5 }}>
                      protected
                    </Box>
                  )}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </>
      </Box>

      {createBranchError && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            mt: 1.5,
            p: 1.25,
            borderRadius: "6px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 15, color: "#ef4444" }} />
          <Typography sx={{ fontSize: "0.75rem", color: "#ef4444" }}>{createBranchError}</Typography>
        </Box>
      )}
    </Box>
  );
}
