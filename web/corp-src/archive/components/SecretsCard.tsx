import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import type { PendingSecret, SecretsStatus, UpsertStatus } from "../../types";

// ─── Input style ──────────────────────────────────────────────────────────────

const inputSx = {
  "& .MuiInputBase-root": {
    background: "#f8fafc",
    color: "#0f172a",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: "0.8rem",
    borderRadius: "6px",
  },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#e2e8f0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
  "& .MuiInputBase-input::placeholder": { color: "#94a3b8" },
};

// ─── Validation badge ─────────────────────────────────────────────────────────

function ValidationBadge({ valid, pendingValidation }: { valid: boolean | null; pendingValidation: boolean }) {
  if (pendingValidation) {
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          px: 0.875,
          py: 0.2,
          borderRadius: "4px",
          background: "#fefce8",
          border: "1px solid #fde68a",
          fontSize: "0.62rem",
          fontFamily: "'IBM Plex Mono', monospace",
          color: "#92400e",
          whiteSpace: "nowrap",
        }}
      >
        pending validation
      </Box>
    );
  }
  if (valid === true) {
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.4,
          px: 0.875,
          py: 0.2,
          borderRadius: "4px",
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          fontSize: "0.62rem",
          fontFamily: "'IBM Plex Mono', monospace",
          color: "#16a34a",
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 10 }} />
        valid
      </Box>
    );
  }
  if (valid === false) {
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.4,
          px: 0.875,
          py: 0.2,
          borderRadius: "4px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          fontSize: "0.62rem",
          fontFamily: "'IBM Plex Mono', monospace",
          color: "#ef4444",
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 10 }} />
        invalid
      </Box>
    );
  }
  return null;
}

// ─── Secret key row ───────────────────────────────────────────────────────────

function SecretKeyRow({
  secretKey,
  present,
  valid,
  pending,
  upsertStatus,
  onEdit,
  onCancelPending,
}: {
  secretKey: string;
  present: boolean;
  valid: boolean | null;
  pending: PendingSecret | undefined;
  upsertStatus: UpsertStatus | undefined;
  onEdit: (key: string) => void;
  onCancelPending: (key: string) => void;
}) {
  const [showValue, setShowValue] = useState(false);
  const hasPending = !!pending;
  const isSuccess = upsertStatus?.status === "success";
  const isError = upsertStatus?.status === "error";
  const isSet = present || isSuccess;

  // ── Left icon ────────────────────────────────────────────────────────────
  /*
   * ✓  = set + validated
   * ●  = set, not validated (or never run)
   * ◉  = pending staged change (amber)
   * ○  = not set
   */
  let LeftIcon: typeof CheckCircleIcon;
  let iconColor: string;
  if (hasPending) {
    LeftIcon = RadioButtonCheckedIcon;
    iconColor = "#d97706";
  } else if (isSet && valid === true) {
    LeftIcon = CheckCircleIcon;
    iconColor = "#22c55e";
  } else if (isSet) {
    LeftIcon = RadioButtonCheckedIcon;
    iconColor = "#22c55e";
  } else {
    LeftIcon = RadioButtonUncheckedIcon;
    iconColor = "#cbd5e1";
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 0.875,
        px: 2,
        borderBottom: "1px solid #f8fafc",
        background: isSuccess ? "#f0fdf4" : isError ? "#fef2f2" : hasPending ? "#fffbeb" : "transparent",
        transition: "background 0.2s",
      }}
    >
      {/* Left icon */}
      <LeftIcon sx={{ fontSize: 15, color: iconColor, flexShrink: 0 }} />

      {/* Key name */}
      <Typography
        sx={{
          fontSize: "0.78rem",
          fontFamily: "'IBM Plex Mono', monospace",
          color: hasPending ? "#92400e" : "#0f172a",
          flex: 1,
        }}
      >
        {secretKey}
      </Typography>

      {/* Pending value + visibility toggle + cancel */}
      {hasPending && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography
            sx={{
              fontSize: "0.72rem",
              fontFamily: "'IBM Plex Mono', monospace",
              color: "#d97706",
              letterSpacing: showValue ? "normal" : "0.1em",
            }}
          >
            {showValue ? pending!.value : "•".repeat(Math.min(pending!.value.length, 12))}
          </Typography>
          <IconButton
            size="small"
            onClick={() => setShowValue((v) => !v)}
            sx={{ color: "#94a3b8", p: 0.25, "&:hover": { color: "#475569" } }}
          >
            {showValue ? <VisibilityOffIcon sx={{ fontSize: 13 }} /> : <VisibilityIcon sx={{ fontSize: 13 }} />}
          </IconButton>
          <Tooltip title="Discard change">
            <IconButton
              size="small"
              onClick={() => onCancelPending(secretKey)}
              sx={{ color: "#94a3b8", p: 0.25, "&:hover": { color: "#ef4444" } }}
            >
              <CloseIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Validation badge — hidden while staging */}
      {!hasPending && <ValidationBadge valid={valid} pendingValidation={isSuccess} />}

      {/* Just updated */}
      {isSuccess && (
        <Typography
          sx={{ fontSize: "0.62rem", color: "#16a34a", fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}
        >
          just updated
        </Typography>
      )}

      {/* Update error */}
      {isError && (
        <Tooltip title={upsertStatus!.error ?? "Update failed"}>
          <ErrorOutlineIcon sx={{ fontSize: 14, color: "#ef4444", flexShrink: 0 }} />
        </Tooltip>
      )}

      {/* Not set label */}
      {!isSet && !hasPending && !isError && (
        <Typography sx={{ fontSize: "0.65rem", color: "#cbd5e1", fontFamily: "'IBM Plex Mono', monospace" }}>
          not set
        </Typography>
      )}

      {/* Edit button */}
      <IconButton
        size="small"
        onClick={() => onEdit(secretKey)}
        sx={{ color: "#cbd5e1", p: 0.5, "&:hover": { color: "#2563eb" } }}
      >
        <EditIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );
}

// ─── Secret input dialog ──────────────────────────────────────────────────────

function SecretDialog({
  open,
  secretKey,
  onClose,
  onConfirm,
}: {
  open: boolean;
  secretKey: string;
  onClose: () => void;
  onConfirm: (key: string, value: string) => void;
}) {
  const [value, setValue] = useState("");

  const handleConfirm = () => {
    if (!value.trim()) return;
    onConfirm(secretKey, value.trim());
    setValue("");
    onClose();
  };

  const handleClose = () => {
    setValue("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px" } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        <Box>
          <Typography
            sx={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}
          >
            {secretKey}
          </Typography>
          <Typography sx={{ fontSize: "0.72rem", color: "#64748b", mt: 0.25 }}>Enter the secret value</Typography>
        </Box>
        <IconButton onClick={handleClose} size="small" sx={{ color: "#94a3b8" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <Divider sx={{ borderColor: "#f1f5f9" }} />

      <DialogContent sx={{ pt: 2.5 }}>
        <TextField
          fullWidth
          size="small"
          autoFocus
          type="password"
          placeholder="Secret value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
          }}
          sx={inputSx}
          InputProps={{ endAdornment: <InputAdornment position="end" /> }}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mt: 2.5 }}>
          <Button onClick={handleClose} size="small" sx={{ color: "#64748b", textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!value.trim()}
            variant="contained"
            size="small"
            sx={{
              background: "#2563eb",
              textTransform: "none",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.8rem",
              "&:hover": { background: "#1d4ed8" },
              "&.Mui-disabled": { background: "#f1f5f9", color: "#cbd5e1" },
            }}
          >
            Set
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  requiredKeys: string[];
  presentKeys: string[];
  secretsStatus: SecretsStatus;
  // Controlled by EnvironmentCard
  pendingSecrets: PendingSecret[];
  onSetPending: (key: string, value: string) => void;
  onCancelPending: (key: string) => void;
  upsertStatuses: UpsertStatus[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SecretsCard({
  requiredKeys,
  presentKeys,
  secretsStatus,
  pendingSecrets,
  onSetPending,
  onCancelPending,
  upsertStatuses,
}: Props) {
  const [dialogKey, setDialogKey] = useState<string | null>(null);

  return (
    <Box>
      {/* Key list */}
      <Box sx={{ border: "1px solid #f1f5f9", borderRadius: "8px", overflow: "hidden" }}>
        {requiredKeys.map((k) => (
          <SecretKeyRow
            key={k}
            secretKey={k}
            present={presentKeys.includes(k)}
            valid={secretsStatus.valid}
            pending={pendingSecrets.find((p) => p.key === k)}
            upsertStatus={upsertStatuses.find((s) => s.key === k)}
            onEdit={(key) => setDialogKey(key)}
            onCancelPending={onCancelPending}
          />
        ))}
      </Box>

      <SecretDialog
        open={!!dialogKey}
        secretKey={dialogKey ?? ""}
        onClose={() => setDialogKey(null)}
        onConfirm={onSetPending}
      />
    </Box>
  );
}
