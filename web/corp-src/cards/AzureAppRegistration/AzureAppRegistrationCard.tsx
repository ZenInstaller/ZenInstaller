import { useState, useEffect, useRef } from "react";
import { Box, Button, Collapse, TextField, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { Account, CardChrome, GhEnv } from "../../types";
import type { UseAzureAppRegistrationCard } from "./useAzureAppRegistrationCard";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { AZURE_APP_REGISTRATIONS_URL, getAppRegistrationUrl } from "./consoleUrls";
import { AZURE_APP_KEYS } from "../../logic/variables";
import CloudVariableDetail from ".././CloudVariableDetail";
import { MONO as mono, labelSx } from "../../config/styles";

type Props = {
  card: CardChrome;
  appReg: UseAzureAppRegistrationCard;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  subscriptionId: string;
  variables: UseGithubVariables;
  githubUrl?: string;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Create an app registration for GitHub Actions and grant it access on your selected subscription. Name it and
      create it — the AZURE_CLIENT_ID connection variables are written to GitHub automatically.
    </Typography>
  );
}

function Action({ clientId }: { clientId: string }) {
  return <ViewLink href={clientId ? getAppRegistrationUrl(clientId) : AZURE_APP_REGISTRATIONS_URL} />;
}

export default function AzureAppRegistrationCard({
  card,
  appReg,
  githubAccount,
  repoName,
  selectedEnv,
  subscriptionId,
  variables,
  githubUrl,
}: Props) {
  const {
    azureAccount,
    appName,
    setAppName,
    setEnvironments,
    steps,
    result,
    runNonce,
    running,
    reset,
    run,
    prefillAppName,
    rbacStatus,
    rbacMissingRoles,
    planClientIdMismatch,
    onVariablesComplete,
  } = appReg;
  const disabled = card.locked;
  const [varExpanded, setVarExpanded] = useState(false);
  const [autoSaveCounter, setAutoSaveCounter] = useState(0);
  const [bannerState, setBannerState] = useState<"none" | "saved" | "no-changes" | "error">("none");
  const prevRunNonceRef = useRef(runNonce);
  const prefilledNameRef = useRef(false);
  const varExpandedInitRef = useRef(false);

  const varHasAny = AZURE_APP_KEYS.some((k) => !!variables.values[k]);
  // App was created (persisted result) but doesn't exist in the currently selected tenant.
  const spNotFound = !!result && rbacStatus === "sp-not-found";
  // App exists in this tenant but its SP has no RBAC on the currently selected subscription.
  const rbacMissing = !!result && rbacStatus === "missing-role";

  // Action handlers that also dismiss the banner.
  const handleRetry = () => {
    setBannerState("none");
    reset();
  };
  const handleRun = () => {
    setBannerState("none");
    run();
  };

  // Keep environments in sync with the selected env from parent.
  useEffect(() => {
    if (selectedEnv?.name) setEnvironments([selectedEnv.name]);
  }, [selectedEnv?.name, setEnvironments]);

  // Trigger auto-save + expand after each successful run. Keyed on runNonce rather than `result`
  // becoming non-null, because a persisted result makes a re-run indistinguishable on reload.
  useEffect(() => {
    if (runNonce === prevRunNonceRef.current) return;
    prevRunNonceRef.current = runNonce;
    const t = setTimeout(() => {
      setAutoSaveCounter((c) => c + 1);
      setVarExpanded(true);
    }, 0);
    return () => clearTimeout(t);
  }, [runNonce]);

  // Reset per-env guards when the target env changes.
  useEffect(() => {
    prefilledNameRef.current = false;
    varExpandedInitRef.current = false;
  }, [selectedEnv?.name]);

  // Prefill App registration name from the saved client id (falls back silently if not found).
  useEffect(() => {
    if (prefilledNameRef.current || !azureAccount) return;
    const savedClientId = variables.values.AZURE_CLIENT_ID;
    if (!savedClientId) return;
    prefilledNameRef.current = true;
    void prefillAppName(savedClientId);
  }, [azureAccount, variables.values, prefillAppName]);

  // Auto-expand once, based on whether any saved value already exists — fires once the shared
  // cache has settled (already loaded, or just finished loading), not on every later edit.
  useEffect(() => {
    if (varExpandedInitRef.current) return;
    if (!githubAccount || !repoName || !selectedEnv?.name) return;
    if (variables.loading || variables.error) return;
    varExpandedInitRef.current = true;
    setVarExpanded(varHasAny);
  }, [variables.loading, variables.error, variables.values, githubAccount, repoName, selectedEnv?.name, varHasAny]);

  const populate = result ? { AZURE_CLIENT_ID: result.clientId, AZURE_PLAN_CLIENT_ID: result.clientId } : undefined;
  const keyErrors = spNotFound
    ? { AZURE_CLIENT_ID: "Not found in the selected tenant", AZURE_PLAN_CLIENT_ID: "Not found in the selected tenant" }
    : undefined;

  return (
    <Card
      title="Create an app registration in Azure"
      action={<Action clientId={appReg.spClientId} />}
      lockedIntro={<Intro />}
      {...card}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {/* ── Result banner (shown after create+auto-save completes) ── */}
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

        {/* ── App registration section ── */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Description — always visible */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Intro />
          </Box>

          {/* Requires the Azure sign-in from the Azure login card */}
          {azureAccount && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {!subscriptionId && (
                <Box sx={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "8px", px: 2, py: 1.25 }}>
                  <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
                    Pick a subscription in the <b>Azure subscription</b> card first — this app registration grants
                    access on it.
                  </Typography>
                </Box>
              )}

              {spNotFound && (
                <Box
                  sx={{
                    background: "#fef9c3",
                    border: "1px solid #fde047",
                    borderRadius: "8px",
                    px: 2,
                    py: 1.25,
                    display: "flex",
                    gap: 1,
                  }}
                >
                  <WarningAmberIcon sx={{ fontSize: 16, color: "#d97706", flexShrink: 0 }} />
                  <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
                    This app registration doesn't exist in the selected tenant — create a new one.
                  </Typography>
                </Box>
              )}

              {rbacMissing && (
                <Box
                  sx={{
                    background: "#fef9c3",
                    border: "1px solid #fde047",
                    borderRadius: "8px",
                    px: 2,
                    py: 1.25,
                    display: "flex",
                    gap: 1,
                  }}
                >
                  <WarningAmberIcon sx={{ fontSize: 16, color: "#d97706", flexShrink: 0 }} />
                  <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
                    Missing on the selected subscription: <b>{rbacMissingRoles.join(", ") || "access"}</b> — re-run to
                    grant it.
                  </Typography>
                </Box>
              )}

              {planClientIdMismatch && (
                <Box
                  sx={{
                    background: "#fef9c3",
                    border: "1px solid #fde047",
                    borderRadius: "8px",
                    px: 2,
                    py: 1.25,
                    display: "flex",
                    gap: 1,
                  }}
                >
                  <WarningAmberIcon sx={{ fontSize: 16, color: "#d97706", flexShrink: 0 }} />
                  <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
                    AZURE_PLAN_CLIENT_ID doesn't match AZURE_CLIENT_ID — re-run to bring it back in sync.
                  </Typography>
                </Box>
              )}

              {/* App name + create button */}
              {steps.length === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Box>
                    <Typography sx={{ ...labelSx, mb: 0.75 }}>App registration name</Typography>
                    <TextField
                      size="small"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      sx={{ minWidth: 280 }}
                      inputProps={{
                        "data-sensitive": true,
                        style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" },
                      }}
                    />
                  </Box>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                    <Button
                      variant="contained"
                      onClick={handleRun}
                      disabled={disabled || !subscriptionId || !appName.trim()}
                      sx={{
                        background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                        textTransform: "none",
                        ...mono,
                        fontSize: "0.85rem",
                        py: 0.85,
                        px: 2.5,
                        borderRadius: "8px",
                        boxShadow: "0 2px 6px #2563eb33",
                        "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
                        "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
                      }}
                    >
                      {rbacMissing ? "Grant access on this subscription" : "Create app registration"}
                    </Button>
                    {varHasAny && !rbacMissing && !spNotFound && (
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

              {/* Progress steps */}
              {steps.length > 0 && (
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 0.25, borderLeft: "2px solid #e2e8f0", pl: 1.5 }}
                >
                  {steps.map((s) => (
                    <StepRow key={s.id} step={s} />
                  ))}
                  {running && (
                    <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>Running...</Typography>
                  )}
                  {!running && (
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
            </Box>
          )}
        </Box>

        {/* ── Divider (clickable toggle) ── */}
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

        {/* ── Variable editor (unmountOnExit=false keeps in-progress draft edits and auto-save state alive while collapsed) ── */}
        <Collapse in={varExpanded} timeout={300} unmountOnExit={false}>
          <CloudVariableDetail
            account={githubAccount}
            repo={repoName}
            envName={selectedEnv?.name ?? null}
            keys={AZURE_APP_KEYS}
            variables={variables}
            populate={populate}
            title="Connection details"
            disabled={disabled}
            keyErrors={keyErrors}
            onComplete={onVariablesComplete}
            onAutoSaveResult={(result) => setBannerState(result)}
            githubUrl={githubUrl}
            autoSaveCounter={autoSaveCounter}
          />
        </Collapse>
      </Box>
    </Card>
  );
}
