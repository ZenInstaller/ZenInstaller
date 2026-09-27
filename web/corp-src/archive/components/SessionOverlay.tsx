import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

type Props = {
  sessionExpired: boolean;
  redirecting: "login" | "logout" | null;
  onLogin: () => void;
};

export default function SessionOverlay({ sessionExpired, redirecting, onLogin }: Props) {
  return (
    <>
      <Dialog open={sessionExpired} disableEscapeKeyDown>
        <DialogTitle sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600, fontSize: "1rem", pb: 0.5 }}>
          Session Expired
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.875rem", color: "#475569", fontFamily: "'IBM Plex Sans', sans-serif" }}>
            Your login session has expired. Please sign in again to continue.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            variant="contained"
            onClick={onLogin}
            sx={{
              background: "#2563eb",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.8rem",
              textTransform: "none",
              "&:hover": { background: "#1d4ed8" },
            }}
          >
            Sign in again
          </Button>
        </DialogActions>
      </Dialog>

      {redirecting && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            background: "rgba(248,250,252,0.85)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <CircularProgress size={28} sx={{ color: "#2563eb" }} />
          <Typography sx={{ fontSize: "0.85rem", color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>
            {redirecting === "login" ? "Redirecting to GitHub..." : "Logging out..."}
          </Typography>
        </Box>
      )}
    </>
  );
}
