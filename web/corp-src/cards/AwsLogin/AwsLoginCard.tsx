import { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew"; //Todo: check why this import could not be found or why it is missing
import Visibility from "@mui/icons-material/Visibility"; //Todo: check why this import could not be found or why it is missing
import VisibilityOff from "@mui/icons-material/VisibilityOff"; //Todo: check why this import could not be found or why it is missing
import WarningAmberIcon from "@mui/icons-material/WarningAmber"; //Todo: check why this import could not be found or why it is missing
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import { getAwsConsoleUrl } from "./consoleUrls";
import { CLOUD_DOCS } from "./docsConfig";
import type { UseAwsLoginCard } from "./useAwsLoginCard";
import type { CardChrome } from "../../types";

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
type Props = {
  card: CardChrome;
  awsLogin: UseAwsLoginCard;
};

function Intro() {
  return (
    <Typography sx={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
      Sign in with your AWS access key in this browser. We never send your long-term AWS access key or secret key to our
      servers; only short-term AWS session credentials are kept in this tab until they expire.
      <>
        <br />
        You will need to copy the credentials from AWS after&nbsp;
        <Box
          component="a"
          href={CLOUD_DOCS.aws.bootstrapCredentials}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: "inline-flex",
            color: "#2563eb",
            textDecoration: "none",
            alignItems: "center",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          following the AWS set-up guide
          <OpenInNewIcon sx={{ fontSize: 11 }} />
        </Box>
        <br />
        If you do not have an AWS account yet,&nbsp;
        <Box
          component="a"
          href={CLOUD_DOCS.aws.createAccount}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: "inline-flex",
            color: "#2563eb",
            textDecoration: "none",
            alignItems: "center",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          Create a free one
          <OpenInNewIcon sx={{ fontSize: 11 }} />
        </Box>
      </>
    </Typography>
  );
}

function Action() {
  return <ViewLink href={getAwsConsoleUrl()} />;
}

export default function AwsLoginCard({ card, awsLogin }: Props) {
  const [showSecret, setShowSecret] = useState(false);
  const {
    accessKeyId,
    setAccessKeyId,
    secretAccessKey,
    setSecretAccessKey,
    account,
    mfaDevices,
    selectedMfaSerial,
    setSelectedMfaSerial,
    mfaTokenCode,
    setMfaTokenCode,
    needsMfa,
    fidoOnly,
    done,
    loggingIn,
    signInError,
    canSignIn,
    login,
    logout,
  } = awsLogin;
  const usableDevices = mfaDevices.filter((d) => d.usable);

  return (
    <Card title="AWS login" action={<Action />} lockedIntro={<Intro />} {...card}>
      <Box
        component="form"
        // Gives the browser's password manager a real submit to detect, so it can offer to save the key pair.
        onSubmit={(e) => {
          e.preventDefault();
          if (canSignIn && !loggingIn) login();
        }}
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
      >
        <Intro />

        {!done && (
          <>
            <Box>
              <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mb: 1.5, lineHeight: 1.6 }}>
                Generate access keys from your AWS account's Security credentials. They're exchanged for short-term
                session credentials and can be deleted after setup.
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <TextField
                  size="small"
                  label="Access Key ID"
                  name="username"
                  autoComplete="username"
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  placeholder="AKIA..."
                  disabled={!!account || loggingIn || card.locked}
                  sx={{ maxWidth: 340 }}
                  InputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
                />
                <TextField
                  size="small"
                  label="Secret Access Key"
                  type={showSecret ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  disabled={!!account || loggingIn || card.locked}
                  sx={{ maxWidth: 340 }}
                  InputProps={{
                    style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" },
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          type="button"
                          onClick={() => setShowSecret((v) => !v)}
                          edge="end"
                          tabIndex={-1}
                        >
                          {showSecret ? <VisibilityOff sx={{ fontSize: 16 }} /> : <Visibility sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
            </Box>
          </>
        )}

        {account && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: "0.78rem", color: "#64748b" }}>
              {done ? "Signed in as " : "Authenticating as "}
              <Box component="span" sx={{ fontWeight: 600, ...mono }}>
                {account.username}
              </Box>
              <Box component="span" sx={mono}>
                {" "}
                ({account.accountId})
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
        )}

        {needsMfa && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {usableDevices.length > 1 && (
              <TextField
                select
                size="small"
                label="MFA device"
                value={selectedMfaSerial ?? ""}
                onChange={(e) => setSelectedMfaSerial(e.target.value)}
                helperText="Pick the device you have on hand"
                sx={{ maxWidth: 280 }}
                InputProps={{ style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem" } }}
              >
                {usableDevices.map((d) => (
                  <MenuItem key={d.serialNumber} value={d.serialNumber} sx={{ fontSize: "0.8rem", ...mono }}>
                    {d.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              size="small"
              label="MFA code"
              value={mfaTokenCode}
              onChange={(e) => setMfaTokenCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSignIn && !loggingIn) login();
              }}
              placeholder="123456"
              autoFocus
              helperText={
                usableDevices.length > 1
                  ? "Code from the selected device"
                  : `Code from ${usableDevices[0]?.name ?? "your MFA device"}`
              }
              inputProps={{
                maxLength: 6,
                style: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.8rem", letterSpacing: "0.2em" },
              }}
              sx={{ maxWidth: 160 }}
            />
          </Box>
        )}

        {fidoOnly && (
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, maxWidth: 420 }}>
            <WarningAmberIcon sx={{ fontSize: 14, color: "#d97706", mt: "2px" }} />
            <Typography sx={{ fontSize: "0.68rem", color: "#92400e", lineHeight: 1.6 }}>
              Your only MFA is a security key (FIDO), which AWS can't use for CLI/API sign-in. We'll continue without
              MFA — if your account requires MFA, register an authenticator-app (TOTP) device or use access keys that
              don't enforce MFA.
            </Typography>
          </Box>
        )}

        {!done && (
          <Box>
            <Button
              variant="contained"
              type="submit"
              disabled={card.locked || !canSignIn || loggingIn}
              startIcon={loggingIn ? <CircularProgress size={14} sx={{ color: "inherit" }} /> : undefined}
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
                "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
              }}
            >
              {loggingIn ? "Signing in..." : needsMfa ? "Verify & sign in" : "Sign in"}
            </Button>
          </Box>
        )}

        {signInError && <Typography sx={{ fontSize: "0.72rem", color: "#ef4444" }}>{signInError}</Typography>}
      </Box>
    </Card>
  );
}
