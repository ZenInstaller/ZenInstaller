import { useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { MONO as mono, labelSx } from "../../config/styles";

// A labelled value with a copy button. `masked` hides the value but still copies the real one.
export default function CopyRow({ label, value, masked = false }: { label: string; value: string; masked?: boolean }) {
  const [copied, setCopied] = useState(false);
  const displayValue = masked ? "*".repeat(Math.max(value.length, 12)) : value;
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
      <Typography sx={{ ...labelSx, minWidth: 180 }}>{label}</Typography>
      <Typography
        sx={{
          fontSize: "0.78rem",
          color: "#1e293b",
          ...mono,
          ...(masked ? { flex: "0 0 auto" } : { flex: 1, wordBreak: "break-all" }),
        }}
      >
        {displayValue}
      </Typography>
      <Button
        size="small"
        onClick={copy}
        sx={{ minWidth: 0, p: 0.5, color: "#94a3b8", "&:hover": { color: "#2563eb" } }}
      >
        <ContentCopyIcon sx={{ fontSize: 13 }} />
        <Typography sx={{ fontSize: "0.65rem", ml: 0.5, ...mono }}>{copied ? "Copied" : "Copy"}</Typography>
      </Button>
    </Box>
  );
}
