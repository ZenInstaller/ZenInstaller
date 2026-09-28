import { useState } from "react";
import { Box, Button, CircularProgress, IconButton, MenuItem, Select, TextField, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { UseCoreInfraCard } from "./useCoreInfraCard";
import StepRow from "../StepRow";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { AZURE_RESOURCE_GROUPS_URL, getAzureResourceUrl } from "../../logic/consoleUrls";
import { resourceGroupScope } from "../../api/azureArm";
import { getVariableDisplayName, CORP_NAME_KEYS } from "../../logic/variables";
import CloudVariableDetail from "../CloudVariableDetail";
import type { UseGithubVariables } from "../../hooks/useGithubVariables";
import { MONO as mono, labelSx } from "../../config/styles";
import type { Account, CardChrome, AzureAccount, GhEnv } from "../../types";

type Props = {
  card: CardChrome;
  infra: UseCoreInfraCard;
  azureAccount: AzureAccount | null;
  corpName: string;
  subscriptionId: string;
  spClientId: string;
  githubAccount: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variables: UseGithubVariables;
  githubUrl?: string;
};

function Intro({ containerName }: { containerName: string }) {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Creates the root Azure resources — resource group, Log Analytics, Application Insights, the private storage
      account — then the{" "}
      <Box component="span" sx={mono}>
        {containerName}
      </Box>{" "}
      container Terraform uses for state, granting GitHub Actions access to it.
    </Typography>
  );
}

function Action({ resourceId }: { resourceId: string | null }) {
  return <ViewLink href={resourceId ? getAzureResourceUrl(undefined, resourceId) : AZURE_RESOURCE_GROUPS_URL} />;
}

export default function CoreInfraCard({
  card,
  infra,
  azureAccount,
  corpName,
  subscriptionId,
  spClientId,
  githubAccount,
  repoName,
  selectedEnv,
  variables,
  githubUrl,
}: Props) {
  const {
    location,
    setLocation,
    locations,
    locationsLoading,
    locationsError,
    steps,
    running,
    done,
    infraRbacStatus,
    resultMatches,
    run,
    reset,
    resourceGroupName,
    lawName,
    storageAccountName,
    appInsightsName,
    containerName,
  } = infra;
  const disabled = card.locked;
  const [editingLocation, setEditingLocation] = useState(false);

  const missing: string[] = [];
  if (!corpName) missing.push(getVariableDisplayName("NAME"));
  if (!subscriptionId) missing.push("AZURE_SUBSCRIPTION_ID");
  if (!spClientId) missing.push("AZURE_CLIENT_ID");
  const ready = !!azureAccount && missing.length === 0;

  // Previously completed for this target, but the live check now shows the resource group is gone or the SP lost access.
  const rgNotFound = resultMatches && infraRbacStatus === "rg-not-found";
  const rgRbacMissing = resultMatches && infraRbacStatus === "missing-role";

  const locationDisplayName = locations.find((l) => l.name === location)?.displayName ?? location;

  const rgExists =
    !!subscriptionId &&
    !!infra.resourceGroupName &&
    (infra.infraRbacStatus === "ready" || infra.infraRbacStatus === "missing-role");

  return (
    <Card
      title="Terraform state backend"
      action={<Action resourceId={rgExists ? resourceGroupScope(subscriptionId, infra.resourceGroupName) : null} />}
      lockedIntro={<Intro containerName={containerName} />}
      {...card}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Intro containerName={containerName} />

        {/* Gating hints */}
        {!azureAccount && (
          <Box sx={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "8px", px: 2, py: 1.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
              Sign in with Azure first — this card reuses that session.
            </Typography>
          </Box>
        )}
        {azureAccount && missing.length > 0 && (
          <Box sx={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "8px", px: 2, py: 1.25 }}>
            <Typography sx={{ fontSize: "0.75rem", color: "#713f12" }}>
              Missing before setup can run: <b>{missing.join(", ")}</b>
            </Typography>
          </Box>
        )}

        <CloudVariableDetail
          account={githubAccount}
          repo={repoName}
          envName={selectedEnv?.name ?? null}
          keys={CORP_NAME_KEYS}
          variables={variables}
          title="Company short code"
          githubUrl={githubUrl}
        />

        {rgNotFound && (
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
              The resource group doesn't exist in the selected subscription anymore — re-run to recreate it.
            </Typography>
          </Box>
        )}

        {rgRbacMissing && (
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
              GitHub Actions has no access on the resource group — re-run to grant it.
            </Typography>
          </Box>
        )}

        {/* Planned resources */}
        {ready && steps.length === 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box>
              <Typography sx={{ ...labelSx, mb: 0.75 }}>Resources</Typography>
              <Box
                sx={{ borderLeft: "2px solid #e2e8f0", pl: 1.5, display: "flex", flexDirection: "column", gap: 0.25 }}
              >
                {[
                  ["Resource group", resourceGroupName],
                  ["Log Analytics", lawName],
                  ["App Insights", appInsightsName],
                  ["Storage account", storageAccountName],
                  ["State container", containerName],
                ].map(([label, value]) => (
                  <Typography key={label} sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
                    {label}:{" "}
                    <Box component="span" sx={{ color: "#0f172a" }}>
                      {value}
                    </Box>
                  </Typography>
                ))}

                {/* Location — inline editable */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: "1.6em" }}>
                  {editingLocation ? (
                    <>
                      <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>Location:</Typography>
                      {locations.length > 0 ? (
                        <Select
                          size="small"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          sx={{ fontSize: "0.75rem", ...mono, minWidth: 220, "& .MuiSelect-select": { py: 0.35 } }}
                        >
                          {locations.map((l) => (
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
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder={locationsLoading ? "Loading regions..." : "e.g. australiaeast"}
                          sx={{ minWidth: 220 }}
                          inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                        />
                      )}
                      {locationsLoading && <CircularProgress size={12} />}
                      <IconButton
                        size="small"
                        onClick={() => setEditingLocation(false)}
                        sx={{ color: "#22c55e", p: 0.25 }}
                      >
                        <CheckIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </>
                  ) : (
                    <>
                      <Typography sx={{ fontSize: "0.75rem", color: "#64748b", ...mono }}>
                        Location:{" "}
                        <Box component="span" sx={{ color: "#0f172a" }}>
                          {locationDisplayName}
                        </Box>
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => setEditingLocation(true)}
                        sx={{ color: "#cbd5e1", p: 0.25, "&:hover": { color: "#2563eb" } }}
                      >
                        <EditIcon sx={{ fontSize: 12 }} />
                      </IconButton>
                    </>
                  )}
                </Box>
                {locationsError && (
                  <Typography sx={{ fontSize: "0.68rem", color: "#d97706", ...mono }}>
                    Couldn't load Azure region list — type the region name manually.
                  </Typography>
                )}
              </Box>
            </Box>

            <Button
              variant="contained"
              onClick={run}
              disabled={disabled || running || !location.trim()}
              sx={{
                alignSelf: "flex-start",
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
              {done ? "Re-run setup" : "Create core infrastructure"}
            </Button>
          </Box>
        )}

        {/* Progress steps */}
        {steps.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, borderLeft: "2px solid #e2e8f0", pl: 1.5 }}>
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
            {running && <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.5 }}>Running...</Typography>}
            {!running && (
              <Button
                size="small"
                onClick={reset}
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
                ↩ Start over
              </Button>
            )}
          </Box>
        )}
      </Box>
    </Card>
  );
}
