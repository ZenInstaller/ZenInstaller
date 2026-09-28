import { Box, Button, CircularProgress, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { UseBackendDeployCard } from "./useBackendDeployCard";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getWorkflowRunUrl } from "../../logic/github";
import { MONO as mono, labelSx } from "../../config/styles";
import type { CardChrome } from "../../types";

const when = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleString();

type Props = {
  card: CardChrome;
  backend: UseBackendDeployCard;
  repoFullName: string | null;
};

export default function BackendDeployCard({ card, backend, repoFullName }: Props) {
  const {
    appName,
    latest,
    deployed,
    loadingLatest,
    loadingDeployed,
    building,
    build,
    updateAvailable,
    error,
    steps,
    running,
    run,
  } = backend;

  return (
    <Card
      title="Private Zeninstaller Backend"
      action={repoFullName && latest ? <ViewLink href={getWorkflowRunUrl(repoFullName, latest.runId)} /> : undefined}
      {...card}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.6 }}>
          Builds the Zeninstaller backend in GitHub Actions, then pushes the package straight from this browser to{" "}
          <Box component="span" sx={mono}>
            {appName || "the Function App"}
          </Box>
          .
        </Typography>

        <Box>
          <Typography sx={{ ...labelSx, mb: 0.75 }}>Versions</Typography>
          <Box sx={{ borderLeft: "2px solid #e2e8f0", pl: 1.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
              Latest build:{" "}
              <Box component="span" sx={{ color: "#0f172a" }}>
                {loadingLatest
                  ? "checking..."
                  : latest
                    ? `${latest.sha.slice(0, 7)} · ${when(latest.builtAt)}`
                    : "none yet"}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
              Live on the app:{" "}
              <Box component="span" sx={{ color: "#0f172a" }}>
                {loadingDeployed
                  ? "checking..."
                  : deployed
                    ? `${deployed.sha.slice(0, 7)}${deployed.deployedAt ? ` · ${when(deployed.deployedAt)}` : ""}`
                    : "nothing deployed"}
              </Box>
            </Typography>
          </Box>
        </Box>

        {/* The whole point of tracking versions: say plainly whether anything needs doing. */}
        {!loadingLatest && latest && !updateAvailable && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CheckCircleIcon sx={{ fontSize: 14, color: "#22c55e" }} />
            <Typography sx={{ fontSize: "0.75rem", color: "#15803d", ...mono }}>
              The Function App is running the latest build.
            </Typography>
          </Box>
        )}
        {!loadingLatest && updateAvailable && deployed && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706" }} />
            <Typography sx={{ fontSize: "0.75rem", color: "#92400e", ...mono }}>
              A newer build is available — deploy to pick it up.
            </Typography>
          </Box>
        )}

        {error && (
          <Box sx={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", px: 2, py: 1.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#991b1b" }}>{error}</Typography>
          </Box>
        )}

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            onClick={() => void build()}
            disabled={building || running}
            variant="outlined"
            size="small"
            sx={{
              textTransform: "none",
              ...mono,
              fontSize: "0.75rem",
              borderColor: "#bfdbfe",
              color: "#1d4ed8",
              "&:hover": { borderColor: "#93c5fd", background: "#eff6ff" },
            }}
          >
            {building ? (
              <>
                <CircularProgress size={12} sx={{ mr: 1, color: "#93c5fd" }} />
                Building...
              </>
            ) : (
              "Build"
            )}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={!updateAvailable || running || building}
            variant="contained"
            size="small"
            sx={{
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
              ...mono,
              fontSize: "0.75rem",
              textTransform: "none",
              "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
              "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
            }}
          >
            {running ? (
              <>
                <CircularProgress size={12} sx={{ mr: 1, color: "#93c5fd" }} />
                Deploying...
              </>
            ) : (
              "Deploy"
            )}
          </Button>
        </Box>

        {steps.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </Box>
        )}
      </Box>
    </Card>
  );
}
