import { Box, Button, CircularProgress, Tooltip, Typography } from "@mui/material";
import { ACTION_CONFIG } from "./stageConfig";
import { getActionType } from "../../logic/stage";
import type { PlanItem, PlanSummary } from "../../types";
import { MONO as mono } from "../../config/styles";

function SummaryPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Box
      sx={{
        px: 0.875,
        py: 0.25,
        borderRadius: "4px",
        border: `1px solid ${color}33`,
        color,
        fontSize: "0.65rem",
        ...mono,
      }}
    >
      {label} {count}
    </Box>
  );
}

function BehindPill({ planSha, latestSha }: { planSha?: string; latestSha?: string }) {
  const detail =
    planSha && latestSha
      ? `Planned at ${planSha.slice(0, 7)} \u00b7 the branch is now at ${latestSha.slice(0, 7)}`
      : "";
  return (
    <Tooltip title={detail} placement="top">
      <Box
        sx={{
          px: 0.875,
          py: 0.25,
          borderRadius: "4px",
          border: "1px solid #d9770633",
          background: "#d977060d",
          color: "#d97706",
          fontSize: "0.65rem",
          ...mono,
          textTransform: "none",
          letterSpacing: 0,
          cursor: "default",
        }}
      >
        not latest
      </Box>
    </Tooltip>
  );
}

function DeployButton({ onDeploy, disabled }: { onDeploy: () => void; disabled?: boolean }) {
  return (
    <Button
      disabled={disabled}
      variant="contained"
      size="small"
      onClick={() => void onDeploy()}
      sx={{
        background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
        ...mono,
        fontSize: "0.72rem",
        textTransform: "none",
        py: 0.45,
        px: 1.5,
        "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
        "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
      }}
    >
      Deploy
    </Button>
  );
}

export default function StagePlanDetail({
  items,
  summary,
  loading,
  error,
  onDeploy,
  stagesStale,
  behind,
  planSha,
  latestSha,
}: {
  items: PlanItem[];
  summary: PlanSummary;
  loading: boolean;
  error: string | null;
  onDeploy?: () => void;
  stagesStale?: boolean;
  behind?: boolean;
  planSha?: string;
  latestSha?: string;
}) {
  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
        <CircularProgress size={13} sx={{ color: "#cbd5e1" }} />
        <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", ...mono }}>Loading plan...</Typography>
      </Box>
    );
  }

  if (error) return <Typography sx={{ fontSize: "0.75rem", color: "#ef4444", ...mono }}>{error}</Typography>;

  const hasChanges = summary.create + summary.update + summary.delete + summary.replace > 0;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography
          sx={{
            fontSize: "0.68rem",
            color: "#94a3b8",
            ...mono,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Planned Changes for Deployment
        </Typography>
        {behind && <BehindPill planSha={planSha} latestSha={latestSha} />}
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          mb: hasChanges ? 1.5 : 0,
        }}
      >
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          {hasChanges ? (
            <>
              <SummaryPill label="create" count={summary.create} color="#16a34a" />
              <SummaryPill label="update" count={summary.update} color="#d97706" />
              <SummaryPill label="delete" count={summary.delete} color="#dc2626" />
              {summary.replace > 0 && <SummaryPill label="replace" count={summary.replace} color="#7c3aed" />}
            </>
          ) : (
            <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8", ...mono }}>No changes detected.</Typography>
          )}
        </Box>
        {onDeploy && <DeployButton onDeploy={onDeploy} disabled={stagesStale} />}
      </Box>

      {hasChanges && (
        <Box sx={{ border: "1px solid #f1f5f9", borderRadius: "8px", overflow: "hidden" }}>
          {items.map((item, idx) => {
            const type = getActionType(item.change.actions) ?? "unknown";
            const cfg = ACTION_CONFIG[type];
            return (
              <Box
                key={`${item.address}-${idx}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  px: 2,
                  py: 0.875,
                  borderBottom: idx < items.length - 1 ? "1px solid #f8fafc" : "none",
                  background: idx % 2 === 0 ? "#ffffff" : "#fafafa",
                }}
              >
                <Box sx={{ width: 26, color: cfg.color, fontSize: "0.72rem", fontWeight: 700, ...mono, flexShrink: 0 }}>
                  {cfg.symbol}
                </Box>
                <Typography sx={{ fontSize: "0.75rem", color: "#334155", wordBreak: "break-all", ...mono }}>
                  {item.address}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
