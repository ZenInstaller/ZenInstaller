
// This card handles the setup of AWS IAM roles for GitHub Actions through OIDC.

import { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Collapse, TextField, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getIamRoleUrl } from "./consoleUrls";
import CloudVariableDetail from ".././CloudVariableDetail";
import { AWS_VARIABLE_KEYS } from "../../logic/variables";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import type { SetupStep, UseAwsSetupCard } from "./useAwsSetupCard";
import type { Account, CardChrome, GhEnv } from "../../types";

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const labelSx = {
  fontSize: "0.68rem",
  color: "#94a3b8",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  ...mono,
};

type Props = {
  card: CardChrome;
  awsSetup: UseAwsSetupCard;
  account: Account | null;
  repoName: string;
  repoFullName: string | null;
  selectedEnv: GhEnv | null;
  variables: UseGithubVariables;
  onAwsValid?: (valid: boolean | null) => void;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Create an AWS IAM role GitHub Actions can assume through OIDC, then save the role ARN to this GitHub environment
      so the deployment stages can use the same AWS target.
    </Typography>
  );
}

function Action({ roleName }: { roleName: string }) {
  if (!roleName) return null;
  return <ViewLink href={getIamRoleUrl(roleName)} />;
}

function StepRow({ step }: { step: SetupStep }) {
  const icon =
    step.status === "done" ? (
      <CheckCircleOutlineIcon sx={{ fontSize: 14, color: "#22c55e" }} />
    ) : step.status === "error" ? (
      <ErrorOutlineIcon sx={{ fontSize: 14, color: "#ef4444" }} />
    ) : step.status === "running" ? (
      <CircularProgress size={12} sx={{ color: "#2563eb" }} />
    ) : (
      <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: "#cbd5e1" }} />
    );

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "18px 1fr", alignItems: "start", py: 0.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", height: "1.2em" }}>{icon}</Box>
      <Box>
        <Typography sx={{ fontSize: "0.78rem", color: step.status === "error" ? "#ef4444" : "#475569", ...mono }}>
          {step.label}
        </Typography>
        {step.detail && (
          <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono, mt: 0.25 }}>{step.detail}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default function AwsSetupCard({
  card,
  awsSetup,
  account,
  repoName,
  repoFullName,
  selectedEnv,
  variables,
  onAwsValid,
}: Props) {
  const [varExpanded, setVarExpanded] = useState(false);
  const [loadedVars, setLoadedVars] = useState<Record<string, string> | null>(null);
  const [autoSaveCounter, setAutoSaveCounter] = useState(0);
  const [bannerState, setBannerState] = useState<"none" | "saved" | "no-changes" | "error">("none");
  const prevRoleArnRef = useRef<string | null>(null);
  const prefilledRoleRef = useRef(false);
  const githubUrl =
    repoFullName && selectedEnv
      ? `https://github.com/${repoFullName}/settings/environments/${selectedEnv.id}/edit`
      : undefined;

  const {
    roleName,
    setRoleName,
    setEnvironments,
    loading,
    steps,
    roleArn,
    error,
    canCreate,
    create,
    resetRoleCreation,
  } = awsSetup;

  const varHasAny = !!loadedVars && Object.keys(loadedVars).length > 0;

  useEffect(() => {
    if (selectedEnv?.name) setEnvironments([selectedEnv.name]);
  }, [selectedEnv?.name, setEnvironments]);

  useEffect(() => {
    prefilledRoleRef.current = false;
  }, [selectedEnv?.name]);

  useEffect(() => {
    if (prefilledRoleRef.current || roleArn) return;
    const savedArn = loadedVars?.[AWS_VARIABLE_KEYS[0]];
    const name = savedArn?.split("/").pop();
    if (name) {
      prefilledRoleRef.current = true;
      setRoleName(name);
    }
  }, [loadedVars, roleArn, setRoleName]);

  useEffect(() => {
    if (roleArn && !prevRoleArnRef.current) {
      const t = setTimeout(() => {
        setAutoSaveCounter((c) => c + 1);
        setVarExpanded(true);
      }, 0);
      prevRoleArnRef.current = roleArn;
      return () => clearTimeout(t);
    }
    prevRoleArnRef.current = roleArn ?? null;
  }, [roleArn]);

  const handleCreate = () => {
    setBannerState("none");
    create();
  };
  const handleRetry = () => {
    setBannerState("none");
    resetRoleCreation();
  };
  const populate = roleArn ? { [AWS_VARIABLE_KEYS[0]]: roleArn } : undefined;

  return (
    <Card title="AWS setup" action={<Action roleName={roleName} />} lockedIntro={<Intro />} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Intro />

        {bannerState !== "none" && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              background: bannerState === "error" ? "#fef9c3" : "#f0fdf4",
              border: `1px solid ${bannerState === "error" ? "#fde047" : "#bbf7d0"}`,
              borderRadius: "8px",
              px: 1.5,
              py: 1,
            }}
          >
            {bannerState === "error" ? (
              <WarningAmberIcon sx={{ fontSize: 16, color: "#d97706" }} />
            ) : (
              <CheckCircleOutlineIcon sx={{ fontSize: 16, color: "#16a34a" }} />
            )}
            <Typography sx={{ fontSize: "0.75rem", color: bannerState === "error" ? "#713f12" : "#15803d" }}>
              {bannerState === "saved" && "Connection details saved."}
              {bannerState === "no-changes" && "Connection details saved — no changes needed."}
              {bannerState === "error" && "Some connection details failed to save — check below."}
            </Typography>
          </Box>
        )}

        {steps.length === 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box>
              <Typography sx={{ ...labelSx, mb: 0.75 }}>IAM role name</Typography>
              <TextField
                size="small"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                sx={{ minWidth: 280 }}
                inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                disabled={card.locked}
              />
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <Button
                variant="contained"
                onClick={handleCreate}
                disabled={card.locked || !canCreate}
                sx={{
                  background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                  textTransform: "none",
                  ...mono,
                  fontSize: "0.85rem",
                  py: 1,
                  px: 2.5,
                  borderRadius: "8px",
                  boxShadow: "0 2px 8px #2563eb33",
                  "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
                  "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
                }}
              >
                Create IAM Role
              </Button>
              {varHasAny && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706" }} />
                  <Typography sx={{ fontSize: "0.68rem", color: "#d97706" }}>
                    This will overwrite your current connection details
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {steps.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, borderLeft: "2px solid #e2e8f0", pl: 1.5 }}>
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
            {loading && <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>Running...</Typography>}
            {!loading && (
              <Button
                size="small"
                onClick={handleRetry}
                sx={{
                  alignSelf: "flex-start",
                  mt: 0.5,
                  textTransform: "none",
                  ...mono,
                  fontSize: "0.72rem",
                  color: "#64748b",
                  "&:hover": { color: "#2563eb" },
                }}
              >
                ↩ Try again
              </Button>
            )}
          </Box>
        )}

        {error && <Typography sx={{ fontSize: "0.72rem", color: "#ef4444" }}>{error}</Typography>}

        <Box
          onClick={() => setVarExpanded((e) => !e)}
          sx={{ display: "flex", alignItems: "center", gap: 1.5, cursor: "pointer", userSelect: "none", py: 0.25 }}
        >
          <Box sx={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
          <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono, whiteSpace: "nowrap" }}>
            {varExpanded ? "collapse" : "open to enter application connection detail"}
          </Typography>
          <KeyboardArrowDownIcon
            sx={{
              fontSize: 14,
              color: "#94a3b8",
              transform: varExpanded ? "rotate(180deg)" : "none",
              transition: "transform 0.2s",
            }}
          />
          <Box sx={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
        </Box>

        <Collapse in={varExpanded} timeout={300} unmountOnExit={false}>
          <CloudVariableDetail
            account={account}
            repo={repoName}
            envName={selectedEnv?.name ?? null}
            keys={AWS_VARIABLE_KEYS}
            variables={variables}
            populate={populate}
            title="Connection details"
            disabled={card.locked}
            onComplete={() => undefined}
            onAutoSaveResult={(result) => setBannerState(result)}
            onSaved={() => onAwsValid?.(null)}
            githubUrl={githubUrl}
            onLoaded={(saved) => {
              setLoadedVars(saved);
              setVarExpanded(Object.keys(saved).length > 0);
            }}
            autoSaveCounter={autoSaveCounter}
          />
        </Collapse>
      </Box>
    </Card>
  );
}
