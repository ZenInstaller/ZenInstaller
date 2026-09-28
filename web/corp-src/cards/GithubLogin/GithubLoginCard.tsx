import { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { MONO as monoSx } from "../../config/styles";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getGithubUserUrl, GITHUB_LOGIN_URL } from "../../logic/github";
import RefreshButton from "../../components/RefreshButton";
import { useRefreshIndicator } from "../../hooks/util/useRefreshIndicator";
import type { CardChrome } from "../../types";
import { type UseGithubLoginCard } from "./useGithubLoginCard";

type Props = {
  card: CardChrome;
  auth: UseGithubLoginCard;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Connect your GitHub account so ZenInstaller can create the repository, environment, and secrets needed to deploy
      Zenblox.
    </Typography>
  );
}

function Action({ login }: { login?: string }) {
  return <ViewLink href={login ? getGithubUserUrl(login) : GITHUB_LOGIN_URL} />;
}

export default function GithubLoginCard({ card, auth }: Props) {
  const {
    loggingIn: authLoading,
    account: user,
    login: onLogin,
    logout: onLogout,
    mode,
    setMode,
    token: pat,
    setToken: setPat,
    refresh: onRefresh,
    redirecting,
  } = auth;
  const signingIn = redirecting === "login";
  const [patError, setPatError] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { refreshResult, markClicked } = useRefreshIndicator(refreshing);

  const handleRefresh = async () => {
    markClicked();
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleModeChange = (_: unknown, next: "backend" | "direct" | null) => {
    if (!next) return;
    setMode(next);
  };

  const handlePatSubmit = () => {
    const trimmed = pat.trim();
    if (!trimmed.startsWith("ghp_") && !trimmed.startsWith("github_pat_")) {
      setPatError("Must be a GitHub PAT (ghp_… or github_pat_…)");
      return;
    }
    setPatError("");
    setPat(trimmed);
    onLogin();
  };

  return (
    <Card title="GitHub login" action={<Action login={user?.login} />} lockedIntro={<Intro />} {...card}>
      <Box>
        <Box sx={{ mb: 2 }}>
          <Intro />
        </Box>

        {/* Mode toggle — hidden once logged in */}
        {!user && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: "0.72rem", color: "#64748b", mb: 1 }}>
              <Box component="span" sx={{ ...monoSx, fontWeight: 600 }}>
                Backend
              </Box>{" "}
              signs you in through GitHub's OAuth flow and keeps your access token on the server.{" "}
              <Box component="span" sx={{ ...monoSx, fontWeight: 600 }}>
                Direct (PAT)
              </Box>{" "}
              skips the backend entirely — paste your own Personal Access Token and the browser talks to GitHub
              directly.
            </Typography>
            <ToggleButtonGroup
              value={mode}
              exclusive
              onChange={handleModeChange}
              size="small"
              sx={{
                "& .MuiToggleButton-root": { ...monoSx, fontSize: "0.7rem", textTransform: "none", px: 1.5, py: 0.4 },
              }}
            >
              <ToggleButton value="backend">Backend</ToggleButton>
              <ToggleButton value="direct">Direct (PAT)</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {authLoading ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}>
            <CircularProgress size={16} sx={{ color: "#cbd5e1" }} />
            <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8", ...monoSx }}>
              {signingIn ? "Signing you in..." : "Verifying access..."}
            </Typography>
          </Box>
        ) : !user ? (
          mode === "direct" ? (
            <Box
              component="form"
              // Gives the browser's password manager a real submit to detect, so it can offer to save the token.
              onSubmit={(e) => {
                e.preventDefault();
                handlePatSubmit();
              }}
              sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 400 }}
            >
              {/* Password managers key an entry on a username; the token alone gives them nothing to name it by. */}
              <input type="text" name="username" autoComplete="username" value="github-pat" readOnly hidden />
              <TextField
                size="small"
                type={showPat ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="ghp_… or github_pat_…"
                value={pat}
                onChange={(e) => {
                  setPat(e.target.value);
                  setPatError("");
                }}
                error={!!patError}
                helperText={patError || "Personal Access Token with repo + workflow scopes"}
                inputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      {pat && (
                        <IconButton
                          size="small"
                          onClick={() => {
                            setPat("");
                            setPatError("");
                          }}
                          tabIndex={-1}
                        >
                          <ClearIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => setShowPat((v) => !v)}
                        edge="end"
                        tabIndex={-1}
                        aria-label={showPat ? "Hide token" : "Show token"}
                      >
                        {showPat ? (
                          <VisibilityOffIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
                        ) : (
                          <VisibilityIcon sx={{ fontSize: 14, color: "#94a3b8" }} />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                FormHelperTextProps={{ sx: { ...monoSx, fontSize: "0.68rem" } }}
              />
              <Button
                variant="contained"
                type="submit"
                disabled={!pat?.trim() || signingIn}
                startIcon={signingIn ? <CircularProgress size={14} sx={{ color: "#cbd5e1" }} /> : undefined}
                sx={{
                  alignSelf: "flex-start",
                  background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                  textTransform: "none",
                  ...monoSx,
                  fontSize: "0.8rem",
                  py: 0.75,
                  px: 2,
                  borderRadius: "8px",
                  "&:hover": { background: "linear-gradient(135deg, #1d4ed8, #1e40af)" },
                  "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
                }}
              >
                {signingIn ? "Connecting..." : "Connect with PAT"}
              </Button>
            </Box>
          ) : (
            <Button
              variant="contained"
              onClick={onLogin}
              disabled={signingIn}
              startIcon={signingIn ? <CircularProgress size={14} sx={{ color: "#cbd5e1" }} /> : undefined}
              sx={{
                background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                textTransform: "none",
                ...monoSx,
                fontSize: "0.85rem",
                py: 1,
                px: 2.5,
                borderRadius: "8px",
                boxShadow: "0 2px 8px #2563eb33",
                "&:hover": {
                  background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
                  boxShadow: "0 4px 12px #2563eb44",
                },
                "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1", boxShadow: "none" },
              }}
            >
              {signingIn ? "Connecting..." : "Login with GitHub"}
            </Button>
          )
        ) : (
          <Box>
            <Typography sx={{ fontSize: "0.78rem", color: "#64748b", mb: 2 }}>
              Authenticated as{" "}
              <Box component="span" data-sensitive="true" sx={{ ...monoSx, fontWeight: 600 }}>
                {user.login}
              </Box>
              {mode === "direct" && (
                <Box component="span" sx={{ color: "#94a3b8" }}>
                  {" "}
                  · PAT mode
                </Box>
              )}
              . You can sign out and connect a different account below.
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={onLogout}
                sx={{
                  borderColor: "#e2e8f0",
                  color: "#94a3b8",
                  fontSize: "0.72rem",
                  textTransform: "none",
                  ...monoSx,
                  py: 0.5,
                  "&:hover": { borderColor: "#fecaca", color: "#ef4444" },
                }}
              >
                Sign out
              </Button>
              {/* PAT mode re-verifies the same token, so refreshing only means anything for a backend session. */}
              {mode === "backend" && <RefreshButton busy={refreshing} result={refreshResult} onClick={handleRefresh} />}
            </Box>
          </Box>
        )}
      </Box>
    </Card>
  );
}
