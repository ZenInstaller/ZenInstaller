import { useState } from "react";
import { Box, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { Account, GhEnv, PendingSecret, SecretsStatus, UpsertStatus } from "../../types";
import { AZURE_SECRET_KEYS, AWS_SECRET_KEYS } from "../../logic/variables";
import { fetchPublicKey, upsertSecret } from "../../api";
import { encryptSecret } from "../../logic/crypto";
import SecretsCard from "../../components/SecretsCard";
import RefreshButton from "../../components/RefreshButton";
import SaveButton from "../../components/SaveButton";
import { useRefreshIndicator } from "../../hooks/util/useRefreshIndicator";
import { sectionLabelSx as sectionLabelBase } from "../../config/styles";

// Muted variant of the shared section label (whose default is the darker #0f172a).
const sectionLabelSx = { ...sectionLabelBase, color: "#94a3b8" };

const subLabelSx = {
  fontSize: "0.67rem",
  fontWeight: 600,
  color: "#cbd5e1",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  fontFamily: "'IBM Plex Mono', monospace",
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  account: Account | null;
  repo: string;
  selectedEnv: GhEnv;
  presentKeys: string[];
  azureSecretsStatus: SecretsStatus;
  awsSecretsStatus: SecretsStatus;
  onRecheck: () => void;
  rechecking: boolean;
  recheckFailed?: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnvSecretsDetail({
  account,
  repo,
  selectedEnv,
  presentKeys,
  azureSecretsStatus,
  awsSecretsStatus,
  onRecheck,
  rechecking,
  recheckFailed,
}: Props) {
  const { refreshResult, markClicked } = useRefreshIndicator(rechecking, recheckFailed);

  const [pendingSecrets, setPendingSecrets] = useState<PendingSecret[]>([]);
  const [upsertStatuses, setUpsertStatuses] = useState<UpsertStatus[]>([]);
  const [upserting, setUpserting] = useState(false);

  const handleSetPending = (key: string, value: string) => {
    setPendingSecrets((prev) => {
      const idx = prev.findIndex((p) => p.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { key, value };
        return next;
      }
      return [...prev, { key, value }];
    });
    setUpsertStatuses((prev) => prev.filter((s) => s.key !== key));
  };

  const handleCancelPending = (key: string) => {
    setPendingSecrets((prev) => prev.filter((p) => p.key !== key));
    setUpsertStatuses((prev) => prev.filter((s) => s.key !== key));
  };

  const handleUpsertSecrets = async () => {
    if (!account || !repo || pendingSecrets.length === 0) return;
    setUpserting(true);

    let publicKey: string;
    let keyId: string;
    try {
      const result = await fetchPublicKey(account, repo, selectedEnv.name);
      publicKey = result.key;
      keyId = result.keyId;
    } catch (e) {
      console.error("Failed to fetch public key:", e);
      setUpsertStatuses(
        pendingSecrets.map((p) => ({ key: p.key, status: "error" as const, error: "Failed to fetch key" })),
      );
      setUpserting(false);
      return;
    }

    const statuses: UpsertStatus[] = [];
    for (const pending of pendingSecrets) {
      try {
        const encrypted = await encryptSecret(publicKey, pending.value);
        await upsertSecret(account, repo, pending.key, encrypted, keyId, selectedEnv.name);
        statuses.push({ key: pending.key, status: "success" });
      } catch (e) {
        console.error("Failed to upsert secret:", e);
        statuses.push({ key: pending.key, status: "error", error: "Update failed" });
      }
    }

    setUpsertStatuses(statuses);
    const successKeys = new Set(statuses.filter((s) => s.status === "success").map((s) => s.key));
    setPendingSecrets((prev) => prev.filter((p) => !successKeys.has(p.key)));
    setUpserting(false);
  };

  const totalPending = pendingSecrets.length;

  return (
    <Box sx={{ mb: 2.5 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", mb: 1 }}>
        <Box>
          <Typography sx={{ ...sectionLabelSx, mb: 0.75 }}>Secrets</Typography>
          <Typography sx={{ fontSize: "0.78rem", color: "#64748b" }}>
            The following GitHub Actions secrets must be configured.
          </Typography>
        </Box>
        <RefreshButton
          busy={rechecking}
          result={refreshResult}
          sx={{ ml: 2, mt: 0.25 }}
          onClick={() => {
            markClicked();
            onRecheck();
          }}
        />
      </Box>

      {/* Azure sub-section */}
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography sx={subLabelSx}>Azure</Typography>
          {(() => {
            const n = AZURE_SECRET_KEYS.filter((k) => !presentKeys.includes(k)).length;
            return n > 0 && azureSecretsStatus.configured !== null ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ErrorOutlineIcon sx={{ fontSize: 12, color: "#ea580c" }} />
                <Typography sx={{ fontSize: "0.65rem", color: "#ea580c" }}>{n} not configured</Typography>
              </Box>
            ) : null;
          })()}
        </Box>
        <SecretsCard
          requiredKeys={AZURE_SECRET_KEYS}
          presentKeys={presentKeys}
          secretsStatus={azureSecretsStatus}
          pendingSecrets={pendingSecrets.filter((p) => AZURE_SECRET_KEYS.includes(p.key))}
          onSetPending={handleSetPending}
          onCancelPending={handleCancelPending}
          upsertStatuses={upsertStatuses.filter((s) => AZURE_SECRET_KEYS.includes(s.key))}
        />
      </Box>

      {/* AWS sub-section */}
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Typography sx={subLabelSx}>AWS</Typography>
          {(() => {
            const n = AWS_SECRET_KEYS.filter((k) => !presentKeys.includes(k)).length;
            return n > 0 && awsSecretsStatus.configured !== null ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ErrorOutlineIcon sx={{ fontSize: 12, color: "#ea580c" }} />
                <Typography sx={{ fontSize: "0.65rem", color: "#ea580c" }}>{n} not configured</Typography>
              </Box>
            ) : null;
          })()}
        </Box>
        <SecretsCard
          requiredKeys={AWS_SECRET_KEYS}
          presentKeys={presentKeys}
          secretsStatus={awsSecretsStatus}
          pendingSecrets={pendingSecrets.filter((p) => AWS_SECRET_KEYS.includes(p.key))}
          onSetPending={handleSetPending}
          onCancelPending={handleCancelPending}
          upsertStatuses={upsertStatuses.filter((s) => AWS_SECRET_KEYS.includes(s.key))}
        />
      </Box>

      {/* Update button */}
      <Box sx={{ mt: 2 }}>
        <SaveButton
          verb="Update"
          noun="secret"
          count={totalPending}
          loading={upserting}
          onClick={handleUpsertSecrets}
        />
      </Box>
    </Box>
  );
}
