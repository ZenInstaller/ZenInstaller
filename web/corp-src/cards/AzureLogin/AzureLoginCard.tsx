/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Box, Button, CircularProgress, MenuItem, Select, TextField, Typography } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { CLOUD_DOCS } from "./config";
import { MONO as mono, labelSx } from "../../config/styles";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getEntraOverviewUrl } from "../../logic/consoleUrls";
import ConfigErrorNotice from "../../components/ConfigErrorNotice";
import type { CardChrome } from "../../types";
import type { UseAzureLoginCard } from "./useAzureLoginCard";
import { tenantDisplayName } from "../../logic/tenant";

type Props = {
  card: CardChrome;
  azureLogin: UseAzureLoginCard;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Sign in with Azure so we can create the app registration and cloud resources for you. We never store your Azure credentials — sign-in happens directly
      with Microsoft, and only a short-lived access token is used.
    </Typography>
  );
}

/*
 * Azure sign-in on its own — independent of GitHub, not gated by environment.
 * App-registration, domain, and terraform cards all reuse the session it establishes.
 */
function Action() {
  return <ViewLink href={getEntraOverviewUrl()} />;
}

export default function AzureLoginCard({ card, azureLogin }: Props) {
  if (card.status === "unavailable") {
    return (
      <Card title="Azure login" lockedIntro={<Intro />} {...card}>
        <ConfigErrorNotice />
      </Card>
    );
  }

  const {
    account: azureAccount,
    loggingIn,
    loginError,
    login,
    logout,
    tenants,
    manualTenantId,
    setManualTenantId,
    selectTenant,
    tenantIdError,
    savedTenantId,
    tenantsLoaded,
    tenantPinned,
  } = azureLogin;

  // A tenant list was fetched, but the saved tenant doesn't appear in it — an error, not just a warning.
  const savedTenantNotInList = !!savedTenantId && manualTenantId === savedTenantId && tenants.length > 0 && !tenants.some((t) => t.tenantId === savedTenantId);

  return (
    <Card title="Azure login" action={<Action />} lockedIntro={<Intro />} {...card}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Intro />

        {!azureAccount ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            {loggingIn ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={14} sx={{ color: "#2563eb" }} />
                <Typography sx={{ fontSize: "0.72rem", color: "#64748b" }}>Checking session...</Typography>
              </Box>
            ) : (
              <>
                <Button
                  variant="contained"
                  onClick={login}
                  sx={{
                    alignSelf: "flex-start",
                    background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                    textTransform: "none",
                    ...mono,
                    fontSize: "0.85rem",
                    py: 1,
                    px: 2.5,
                    borderRadius: "8px",
                    boxShadow: "0 2px 8px #2563eb33",
                    "&:hover": {
                      background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
                      boxShadow: "0 4px 12px #2563eb44",
                    },
                  }}
                >
                  Sign in with Azure
                </Button>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8" }}>No Azure account?</Typography>
                  <Box
                    component="a"
                    href={CLOUD_DOCS.azure.createAccount}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.25,
                      color: "#64748b",
                      textDecoration: "none",
                      "&:hover": { color: "#2563eb" },
                    }}
                  >
                    <Typography sx={{ fontSize: "0.7rem" }}>Create a free one</Typography>
                    <OpenInNewIcon sx={{ fontSize: 11 }} />
                  </Box>
                </Box>
              </>
            )}
            {loginError && <Typography sx={{ fontSize: "0.72rem", color: "#ef4444" }}>{loginError}</Typography>}
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: "0.78rem", color: "#64748b" }}>
                Signed in as{" "}
                <Box component="span" data-sensitive="true" data-id="txtAzureUsername" sx={{ fontWeight: 600, ...mono }}>
                  {azureAccount.username}
                </Box>
              </Typography>
              <Button
                size="small"
                onClick={logout}
                sx={{
                  minWidth: 0,
                  fontSize: "0.68rem",
                  color: "#94a3b8",
                  textTransform: "none",
                  ...mono,
                  py: 0.25,
                  "&:hover": { color: "#ef4444" },
                }}
              >
                Sign out
              </Button>
            </Box>

            {/* Tenant */}
            <Box>
              <Typography sx={{ ...labelSx, mb: 0.75 }}>
                Tenant
                {/* Only tells you how to find a tenant to type in, which a pinned tenant makes moot. */}
                <Box
                  component="a"
                  href={CLOUD_DOCS.azure.urlGetTenantId}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    ml: 1,
                    display: tenantPinned ? "none" : "inline-flex",
                    color: "#2563eb",
                    textDecoration: "none",
                    alignItems: "center",
                  }}
                >
                  <Typography
                    component="span"
                    sx={{
                      fontSize: "0.7rem",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    Show page to get Tenant ID
                  </Typography>
                  <OpenInNewIcon sx={{ fontSize: 11 }} />
                </Box>
              </Typography>

              {!tenantsLoaded ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}>
                  <CircularProgress size={16} sx={{ color: "#cbd5e1" }} />
                  <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8", ...mono }}>Loading tenants...</Typography>
                </Box>
              ) : tenants.length > 0 ? (
                // Fetched (or MSA-fallback) list available — plain dropdown, picking loads that tenant immediately.
                <Select
                  // Pinned at build time: the value is shown but is not the user's to change.
                  disabled={tenantPinned}
                  data-id="tenant-select"
                  data-sensitive="true"
                  size="small"
                  value={manualTenantId || ""}
                  onChange={(e) => selectTenant(e.target.value)}
                  displayEmpty
                  renderValue={(v) => {
                    if (!v) return <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", ...mono }}>Select a tenant</Typography>;
                    return <Typography sx={{ fontSize: "0.8rem", ...mono }}>{tenantDisplayName(tenants, v)}</Typography>;
                  }}
                  sx={{ minWidth: { xs: 0, sm: 380 }, width: "100%", fontSize: "0.8rem", ...mono }}
                >
                  {tenants.map((t) => (
                    <MenuItem
                      key={t.tenantId}
                      value={t.tenantId}
                      sx={{ py: 0.75 }}
                      data-id="tenant-option"
                      // data-sensitive="true"
                      data-tenant-name={t.displayName}
                    >
                      <Box>
                        <Typography sx={{ fontSize: "0.8rem", ...mono }}>{tenantDisplayName(tenants, t.tenantId)}</Typography>
                        <Typography data-sensitive="true" sx={{ fontSize: "0.68rem", color: "#94a3b8", ...mono }}>
                          {t.tenantId}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                // Nothing fetched yet (e.g. personal account with no cached tenant) — type one in directly.
                <Box
                  component="form"
                  // A real submit lets the browser record the value, so it offers it back next time.
                  onSubmit={(e) => {
                    e.preventDefault();
                    selectTenant(manualTenantId);
                  }}
                  sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
                >
                  <TextField
                    size="small"
                    name="azure-tenant"
                    autoComplete="on"
                    placeholder="Tenant ID"
                    value={manualTenantId}
                    onChange={(e) => setManualTenantId(e.target.value)}
                    sx={{ minWidth: { xs: 0, sm: 320 }, width: "100%" }}
                    inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                    helperText={tenants.length > 0 ? tenantDisplayName(tenants, manualTenantId) : undefined}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    type="submit"
                    disabled={!manualTenantId.trim()}
                    sx={{
                      background: "#2563eb",
                      textTransform: "none",
                      ...mono,
                      fontSize: "0.78rem",
                      "&:hover": { background: "#1d4ed8" },
                    }}
                  >
                    Confirm tenant
                  </Button>
                </Box>
              )}
              {savedTenantNotInList ? (
                <Typography sx={{ fontSize: "0.72rem", color: "#ef4444", mt: 0.75 }}>Saved tenant not found — please pick another.</Typography>
              ) : (
                tenantIdError && <Typography sx={{ fontSize: "0.72rem", color: "#ef4444", mt: 0.75 }}>{tenantIdError}</Typography>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Card>
  );
}
