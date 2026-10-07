/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { UseWebDeployCard } from "./useWebDeployCard";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getWorkflowRunUrl, getWorkflowUrl } from "../../logic/github";
import { MONO as mono, labelSx } from "../../config/styles";
import CloudVariableDetail from "../CloudVariableDetail";
import { FRONTEND_VARIABLE_KEYS } from "../../logic/variables";
import { GITHUB_OAUTH_DOC } from "./config";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import type { Account, GhEnv } from "../../types";
import type { CardChrome } from "../../types";

const when = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleString();

type Props = {
  card: CardChrome;
  web: UseWebDeployCard;
  repoFullName: string | null;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variables: UseGithubVariables;
  githubUrl?: string;
};

export default function WebDeployCard({ card, web, repoFullName, githubAccount, repoName, selectedEnv, variables, githubUrl }: Props) {
  const {
    storageAccountName,
    siteUrl,
    latest,
    deployed,
    loadingLatest,
    loadingDeployed,
    building,
    build,
    buildWorkflow,
    updateAvailable,
    missingGithubClientId,
    staleVariables,
    error,
    steps,
    running,
    run,
  } = web;

  // Carries this page's query across so the site opens on the same repo and environment.
  const siteLink = siteUrl ? `${siteUrl}/${window.location.search}` : null;

  return (
    <Card
      title="Private Zeninstaller Frontend"
      action={
        repoFullName ? (
          // Before anything has built there is no run to point at, so the workflow's page stands in.
          <ViewLink href={latest ? getWorkflowRunUrl(repoFullName, latest.runId) : getWorkflowUrl(repoFullName, buildWorkflow)} />
        ) : undefined
      }
      {...card}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.6 }}>
          Builds the Zeninstaller frontend in GitHub Actions, then writes the files straight from this browser into the{" "}
          <Box component="span" sx={mono}>
            $web
          </Box>{" "}
          container of{" "}
          <Box component="span" sx={mono}>
            {storageAccountName || "the site's storage account"}
          </Box>
          .
        </Typography>

        <CloudVariableDetail
          account={githubAccount}
          repo={repoName}
          envName={selectedEnv?.name ?? null}
          keys={FRONTEND_VARIABLE_KEYS}
          variables={variables}
          title="Build settings"
          githubUrl={githubUrl}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: -1 }}>
          <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8" }}>Where does this come from?</Typography>
          <Box
            component="a"
            href={GITHUB_OAUTH_DOC}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              color: "#1d4ed8",
              textDecoration: "none",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            <Typography component="span" sx={{ fontSize: "0.7rem", color: "inherit" }}>
              Creating the GitHub OAuth app
            </Typography>
            <OpenInNewIcon sx={{ fontSize: 11 }} />
          </Box>
        </Box>

        {staleVariables.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706" }} />
            <Typography sx={{ fontSize: "0.75rem", color: "#92400e", ...mono }}>
              Changed since the last build: {staleVariables.join(", ")} — build again to pick them up.
            </Typography>
          </Box>
        )}

        {missingGithubClientId && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706" }} />
            <Typography sx={{ fontSize: "0.75rem", color: "#92400e", ...mono }}>
              Set VITE_GITHUB_CLIENT_ID on this environment first — the build bakes it in.
            </Typography>
          </Box>
        )}

        <Box>
          <Typography sx={{ ...labelSx, mb: 0.75 }}>Versions</Typography>
          <Box sx={{ borderLeft: "2px solid #e2e8f0", pl: 1.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
              Latest build:{" "}
              <Box component="span" sx={{ color: "#0f172a" }}>
                {loadingLatest ? "checking..." : latest ? `${latest.sha.slice(0, 7)} (v${latest.version}) · ${when(latest.builtAt)}` : "none yet"}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
              Live on the site:{" "}
              <Box component="span" sx={{ color: "#0f172a" }}>
                {loadingDeployed
                  ? "checking..."
                  : deployed
                    ? `${deployed.sha.slice(0, 7)} (v${deployed.version}) · ${when(deployed.builtAt)}`
                    : "nothing deployed"}
              </Box>
            </Typography>
          </Box>
        </Box>

        {/* Until something is deployed the endpoint is a 404, so the link waits for it. */}
        {siteLink && deployed && (
          <Box>
            <Typography sx={{ ...labelSx, mb: 0.75 }}>Continue in Zeninstaller Private</Typography>
            <Typography
              component="a"
              href={siteLink}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                fontSize: "0.75rem",
                ...mono,
                color: "#1d4ed8",
                wordBreak: "break-all",
                textDecoration: "none",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              {siteLink}
            </Typography>
          </Box>
        )}

        {error && (
          <Box sx={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", px: 2, py: 1.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#991b1b" }}>{error}</Typography>
          </Box>
        )}

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            onClick={() => void build()}
            disabled={building || running || missingGithubClientId}
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
            disabled={!updateAvailable || running || building || missingGithubClientId}
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

          {/* Mutually exclusive with the prompt below, so both share the slot by the button. */}
          {!loadingLatest && latest && !updateAvailable && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <CheckCircleIcon sx={{ fontSize: 14, color: "#22c55e" }} />
              <Typography sx={{ fontSize: "0.75rem", color: "#15803d", ...mono }}>The site is serving the latest build.</Typography>
            </Box>
          )}

          {!loadingLatest && updateAvailable && deployed && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706" }} />
              <Typography sx={{ fontSize: "0.75rem", color: "#92400e", ...mono }}>Ready to deploy the new build</Typography>
            </Box>
          )}
        </Box>

        {steps.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, borderLeft: "2px solid #e2e8f0", pl: 1.5 }}>
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
            {running && <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>Running...</Typography>}
          </Box>
        )}
      </Box>
    </Card>
  );
}
