import { Box, Button, CircularProgress, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LockIcon from "@mui/icons-material/Lock";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { Branch, GhEnv } from "../../types";
import { isValidEnvName } from "./env";
import EnvBranchDetail from "./EnvBranchDetail";
import RefreshButton from "../../components/RefreshButton";
import { useRefreshIndicator } from "../../hooks/util/useRefreshIndicator";
import { getEnvironmentsUrl, getEnvSettingsUrl } from "../../logic/github";

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  envList: GhEnv[];
  validEnvs: readonly string[];
  selectedEnv: GhEnv | null;
  onEnvChange: (env: GhEnv | null) => void;
  lockedByPR: boolean;
  branchMatchWarning: string | null;
  branchMatchError: string | null;
  loading: boolean;
  refreshFailed?: boolean;
  onRefresh: () => void;
  repoFullName: string | null;
  // Branch creation (shown when no branch matches the selected env)
  branches: Branch[];
  sourceBranch: string;
  onSourceBranchChange: (v: string) => void;
  creatingBranch: boolean;
  createBranchError: string | null;
  onCreateBranch: (target: string) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnvDetail({
  envList,
  validEnvs,
  selectedEnv,
  onEnvChange,
  lockedByPR,
  branchMatchWarning,
  branchMatchError,
  loading,
  refreshFailed,
  onRefresh,
  repoFullName,
  branches,
  sourceBranch,
  onSourceBranchChange,
  creatingBranch,
  createBranchError,
  onCreateBranch,
}: Props) {
  const { refreshResult, markClicked } = useRefreshIndicator(loading, refreshFailed);

  const filteredEnvs = envList.filter((e) => isValidEnvName(e.name, validEnvs));
  // Show EnvBranchDetail only when the error is "no branch found" (not PR mismatch / multiple)
  const showBranchCreate = !!selectedEnv && !!branchMatchError && branchMatchError.startsWith("No branch found");
  // Always available once a repo is known — points at the specific env once one's picked, otherwise the environments list (e.g. to add a new one).
  const githubEnvironmentsUrl = repoFullName
    ? selectedEnv
      ? getEnvSettingsUrl(repoFullName, selectedEnv.id)
      : getEnvironmentsUrl(repoFullName)
    : null;

  return (
    <Box>
      {/* ── Environment selection ── */}

      {/* Header row */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#64748b", lineHeight: 1.6 }}>
          Pick the environment to configure.{" "}
          <Box component="span" sx={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
            {validEnvs.join(", ")}
          </Box>{" "}
          are set up separately — everything below applies to the one you pick.
        </Typography>
        {!lockedByPR && (
          <RefreshButton
            busy={loading}
            result={refreshResult}
            sx={{ ml: 2 }}
            onClick={() => {
              markClicked();
              onRefresh();
            }}
          />
        )}
      </Box>

      {/* Env chips */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          py: 1,
        }}
      >
        {loading ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={14} sx={{ color: "#cbd5e1" }} />
            <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>
              Loading environments...
            </Typography>
          </Box>
        ) : filteredEnvs.length === 0 ? (
          <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>
            No environment found, create one manually on GitHub.
          </Typography>
        ) : (
          <Box sx={{ display: !selectedEnv && lockedByPR ? "none" : "flex", gap: 1.5, flexWrap: "wrap" }}>
            {filteredEnvs.map((env) => {
              const isSelected = selectedEnv?.id === env.id;
              return (
                <Box
                  key={env.id}
                  onClick={() => !lockedByPR && onEnvChange(isSelected ? null : env)}
                  sx={{
                    display: isSelected || !lockedByPR ? "inline-flex" : "none",
                    alignItems: "center",
                    gap: 0.75,
                    px: 2,
                    py: 0.75,
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: isSelected ? "#2563eb" : "#e2e8f0",
                    background: isSelected ? "#2563eb" : "#ffffff",
                    color: isSelected ? "#ffffff" : "#475569",
                    fontSize: "0.82rem",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: isSelected ? 700 : 400,
                    cursor: lockedByPR ? "default" : "pointer",
                    userSelect: "none",
                    transition: "all 0.15s",
                    "&:hover": !lockedByPR
                      ? {
                          borderColor: isSelected ? "#1d4ed8" : "#cbd5e1",
                          background: isSelected ? "#1d4ed8" : "#f8fafc",
                        }
                      : {},
                  }}
                >
                  {isSelected && lockedByPR && <LockIcon sx={{ fontSize: 13 }} />}
                  {env.name}
                  {isSelected && lockedByPR && (
                    <Typography
                      component="span"
                      sx={{ fontSize: "0.65rem", fontFamily: "'IBM Plex Mono', monospace", opacity: 0.75, ml: 0.25 }}
                    >
                      from PR
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
        {githubEnvironmentsUrl && (
          <Button
            size="small"
            aria-label="Manage on GitHub"
            endIcon={<OpenInNewIcon sx={{ fontSize: 12 }} />}
            onClick={() => window.open(githubEnvironmentsUrl, "_blank")}
            sx={{
              flexShrink: 0,
              fontSize: "0.7rem",
              color: "#64748b",
              textTransform: "none",
              fontFamily: "'IBM Plex Mono', monospace",
              "&:hover": { color: "#0f172a" },
            }}
          >
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
              Manage on GitHub
            </Box>
          </Button>
        )}
      </Box>

      {/* Branch match error */}
      {branchMatchError && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, my: 1.5 }}>
          <ErrorOutlineIcon sx={{ fontSize: 14, color: "#ef4444", flexShrink: 0 }} />
          <Typography sx={{ fontSize: "0.75rem", color: "#ef4444" }}>{branchMatchError}</Typography>
        </Box>
      )}

      {/* Branch match warning */}
      {branchMatchWarning && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, my: 1.5 }}>
          <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706", flexShrink: 0 }} />
          <Typography sx={{ fontSize: "0.75rem", color: "#d97706" }}>{branchMatchWarning}</Typography>
        </Box>
      )}

      {/* Create branch — only when the selected env has no matching branch */}
      {showBranchCreate && (
        <EnvBranchDetail
          targetBranch={selectedEnv!.name}
          branches={branches}
          sourceBranch={sourceBranch}
          onSourceBranchChange={onSourceBranchChange}
          creatingBranch={creatingBranch}
          createBranchError={createBranchError}
          onCreateBranch={onCreateBranch}
        />
      )}
    </Box>
  );
}
