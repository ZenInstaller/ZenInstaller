/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Collapse, IconButton, MenuItem, Select, TextField, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import type { UsePrivateFrontendInfraCard } from "./usePrivateFrontendInfraCard";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getAzureResourceUrl } from "../../logic/consoleUrls";
import { getPrivateInstallerAppName } from "../../logic/naming";
import { resourceGroupScope } from "../../api/azureArm";
import { MONO as mono, labelSx } from "../../config/styles";
import CloudVariableDetail from "../CloudVariableDetail";
import { PRIVATE_FRONTEND_KEYS } from "../../logic/variables";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import type { Account, CardChrome, GhEnv } from "../../types";

function PlainRow({ label, value }: { label: string; value: string }) {
  return (
    <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
      {label}:{" "}
      <Box component="span" sx={{ color: "#0f172a" }}>
        {value}
      </Box>
    </Typography>
  );
}

type Props = {
  card: CardChrome;
  infra: UsePrivateFrontendInfraCard;
  subscriptionId: string;
  tenantId?: string;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variables: UseGithubVariables;
  githubUrl?: string;
};

export default function PrivateFrontendInfraCard({
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
  const [editingLocation, setEditingLocation] = useState(false);
  const [editingStorage, setEditingStorage] = useState(false);
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

  const rgUrl = subscriptionId ? getAzureResourceUrl(tenantId, resourceGroupScope(subscriptionId, infra.resourceGroupName)) : null;

  const populate =
    infra.result && infra.resultMatches
      ? {
          VITE_AZURE_CLIENT_ID: infra.result.installerClientId,
          SITE_STORAGE_ACCOUNT: infra.result.siteStorageAccount,
        }
      : undefined;

  return (
    <Card title="Private Zeninstaller Environment" action={rgUrl ? <ViewLink href={rgUrl} /> : undefined} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.6 }}>
          The relay behind the stage-card terminal: Web PubSub, the session table, and the Function App that issues group-scoped tokens. Everything
          connects by managed identity — no access key is stored.
        </Typography>

        {infra.steps.length === 0 && (
          <Box>
            <Typography sx={{ ...labelSx, mb: 0.75 }}>Resources</Typography>
            <Box sx={{ borderLeft: "2px solid #e2e8f0", pl: 1.5, display: "flex", flexDirection: "column", gap: 0.25 }}>
              <PlainRow label="Resource group" value={infra.resourceGroupName} />
              <PlainRow label="Log Analytics" value={infra.lawName} />

              {/* Global to Azure, so it has to be changeable when another tenant already holds it. */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: "1.6em" }}>
                <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>Site storage account:</Typography>
                {editingStorage ? (
                  <>
                    <TextField
                      size="small"
                      value={infra.siteStorageAccount}
                      onChange={(e) => infra.setSiteStorageAccount(e.target.value)}
                      error={!!infra.siteStorageError}
                      helperText={infra.siteStorageError ?? undefined}
                      sx={{ width: 200 }}
                      inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem" } }}
                    />
                    {/* Stays open until the name is one this installation can actually create or reuse. */}
                    <IconButton
                      size="small"
                      disabled={infra.siteStorageChecking}
                      onClick={() => void infra.checkSiteStorageAccount().then((ok) => ok && setEditingStorage(false))}
                      sx={{ color: "#22c55e", p: 0.25 }}
                    >
                      {infra.siteStorageChecking ? <CircularProgress size={12} /> : <CheckIcon sx={{ fontSize: 14 }} />}
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Typography sx={{ fontSize: "0.75rem", color: "#0f172a", ...mono }}>{infra.siteStorageAccount}</Typography>
                    <IconButton
                      size="small"
                      onClick={() => setEditingStorage(true)}
                      sx={{ color: "#cbd5e1", p: 0.25, "&:hover": { color: "#2563eb" } }}
                    >
                      <EditIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </>
                )}
              </Box>

              <PlainRow label="Sign-in app registration" value={getPrivateInstallerAppName()} />

              {/* Every resource above lands in this region, so it is chosen before the first run. */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: "1.6em" }}>
                {editingLocation ? (
                  <>
                    <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>Location:</Typography>
                    {infra.locations.length > 0 ? (
                      <Select
                        size="small"
                        value={infra.location}
                        onChange={(e) => infra.setLocation(e.target.value)}
                        sx={{ fontSize: "0.75rem", ...mono, minWidth: 220, "& .MuiSelect-select": { py: 0.35 } }}
                      >
                        {infra.locations.map((l) => (
                          <MenuItem key={l.name} value={l.name} sx={{ fontSize: "0.78rem", ...mono }}>
                            {l.displayName}{" "}
                            <Box component="span" sx={{ color: "#94a3b8", ml: 0.5 }}>
                              ({l.name})
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    ) : (
                      <TextField
                        size="small"
                        value={infra.location}
                        onChange={(e) => infra.setLocation(e.target.value)}
                        placeholder={infra.locationsLoading ? "Loading regions..." : "e.g. australiaeast"}
                        sx={{ minWidth: 220 }}
                        inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                      />
                    )}
                    {infra.locationsLoading && <CircularProgress size={12} />}
                    <IconButton size="small" onClick={() => setEditingLocation(false)} sx={{ color: "#22c55e", p: 0.25 }}>
                      <CheckIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
                      Location:{" "}
                      <Box component="span" sx={{ color: "#0f172a" }}>
                        {infra.locations.find((l) => l.name === infra.location)?.displayName ?? infra.location}
                      </Box>
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => setEditingLocation(true)}
                      sx={{ color: "#cbd5e1", p: 0.25, "&:hover": { color: "#2563eb" } }}
                    >
                      <EditIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </>
                )}
              </Box>
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
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, borderLeft: "2px solid #e2e8f0", pl: 1.5 }}>
            {infra.steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
            {infra.running && <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>Running...</Typography>}
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
            keys={PRIVATE_FRONTEND_KEYS}
            hiddenKeys={["SITE_STORAGE_ACCOUNT"]}
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
