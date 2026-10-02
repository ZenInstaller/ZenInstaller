import { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Collapse, Typography } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import type { UseRemoteTerminalInfraCard } from "./useRemoteTerminalInfraCard";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getAzureResourceUrl } from "../../logic/consoleUrls";
import { resourceGroupScope } from "../../api/azureArm";
import { MONO as mono, labelSx } from "../../config/styles";
import CloudVariableDetail from "../CloudVariableDetail";
import { DEPLOYMENT_TERMINAL_KEYS } from "../../logic/variables";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import type { Account, CardChrome, GhEnv } from "../../types";

type Props = {
  card: CardChrome;
  infra: UseRemoteTerminalInfraCard;
  subscriptionId: string;
  tenantId?: string;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variables: UseGithubVariables;
  githubUrl?: string;
};

export default function RemoteTerminalInfraCard({
  card,
  infra,
  subscriptionId,
  tenantId,
  githubAccount,
  repoName,
  selectedEnv,
  variables,
  githubUrl,
}: Props) {
  const [varExpanded, setVarExpanded] = useState(false);
  const [autoSaveCounter, setAutoSaveCounter] = useState(0);
  const prevRunNonceRef = useRef(infra.runNonce);

  useEffect(() => {
    if (infra.runNonce === prevRunNonceRef.current) return;
    prevRunNonceRef.current = infra.runNonce;
    const t = setTimeout(() => {
      setAutoSaveCounter((c) => c + 1);
      setVarExpanded(true);
    }, 0);
    return () => clearTimeout(t);
  }, [infra.runNonce]);

  const rgUrl = subscriptionId
    ? getAzureResourceUrl(tenantId, resourceGroupScope(subscriptionId, infra.resourceGroupName))
    : null;

  const populate =
    infra.result && infra.resultMatches
      ? {
          WEBPUBSUB_ENDPOINT: infra.result.webPubSubHost,
          WEBPUBSUB_CLIENT_ID: infra.result.pipelineClientId,
          WEBPUBSUB_TENANT_ID: infra.result.pipelineTenantId,
          BACKEND_API: infra.result.apiUrl,
        }
      : undefined;

  return (
    <Card title="Private Zeninstaller Environment" action={rgUrl ? <ViewLink href={rgUrl} /> : undefined} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.6 }}>
          The relay behind the stage-card terminal: Web PubSub, the session table, and the Function App that issues
          group-scoped tokens. Everything connects by managed identity — no access key is stored.
        </Typography>

        {infra.steps.length === 0 && (
          <Box>
            <Typography sx={{ ...labelSx, mb: 0.75 }}>Resources</Typography>
            <Box sx={{ borderLeft: "2px solid #e2e8f0", pl: 1.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
              {[
                ["Resource group", infra.resourceGroupName],
                ["Web PubSub", infra.webPubSubName],
                ["Hub", infra.hubName],
                ["Function App", infra.functionAppName],
                ["Storage account", infra.storageAccountName],
              ].map(([label, value]) => (
                <Typography key={label} sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
                  {label}:{" "}
                  <Box component="span" sx={{ color: "#0f172a" }}>
                    {value}
                  </Box>
                </Typography>
              ))}
            </Box>
          </Box>
        )}

        <Box>
          <Button
            onClick={() => void infra.run()}
            disabled={infra.running}
            variant="contained"
            size="small"
            sx={{
              background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
              ...mono,
              fontSize: "0.75rem",
              textTransform: "none",
              py: 0.6,
              px: 2,
              "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
              "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
            }}
          >
            {infra.running ? (
              <>
                <CircularProgress size={12} sx={{ mr: 1, color: "#93c5fd" }} />
                Creating...
              </>
            ) : infra.done ? (
              "Re-run"
            ) : (
              "Create terminal relay"
            )}
          </Button>
        </Box>

        {infra.steps.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {infra.steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </Box>
        )}

        {/* ── Divider (clickable toggle) ── */}
        <Box
          onClick={() => setVarExpanded((e) => !e)}
          sx={{ display: "flex", alignItems: "center", gap: 1.5, cursor: "pointer", userSelect: "none", py: 0.25 }}
        >
          <Box sx={{ flex: 1, height: "1px", background: "#e2e8f0" }} />
          <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono, whiteSpace: "nowrap" }}>
            {varExpanded ? "collapse" : "open to enter connection detail"}
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

        {/* unmountOnExit=false keeps draft edits alive while collapsed */}
        <Collapse in={varExpanded} timeout={300} unmountOnExit={false}>
          <CloudVariableDetail
            account={githubAccount}
            repo={repoName}
            envName={selectedEnv?.name ?? null}
            keys={DEPLOYMENT_TERMINAL_KEYS}
            variables={variables}
            populate={populate}
            title="Connection details"
            githubUrl={githubUrl}
            autoSaveCounter={autoSaveCounter}
          />
        </Collapse>
      </Box>
    </Card>
  );
}
