import { useCallback, useEffect, useRef, useState } from "react";
import type { PendingRestore } from "../../types";

export type { PendingRestore }; // re-export so existing hook imports still work

export interface UseUrlRestore {
  urlRestoreMsg: { loading: boolean; warnings: string[] };
  setUrlRestoreMsg: React.Dispatch<React.SetStateAction<{ loading: boolean; warnings: string[] }>>;
  pendingRestore: React.MutableRefObject<PendingRestore>;
  urlAccountApplied: React.MutableRefObject<boolean>;
  addRestoreWarning: (msg: string) => void;
  checkRestoreDone: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useUrlRestore(): UseUrlRestore {
  const pendingRestore = useRef<PendingRestore>({
    account: new URLSearchParams(window.location.search).get("account"),
    repo: new URLSearchParams(window.location.search).get("repo"),
    pr: new URLSearchParams(window.location.search).get("pr"),
    env: new URLSearchParams(window.location.search).get("env"),
  });
  const urlAccountApplied = useRef(false);

  const [urlRestoreMsg, setUrlRestoreMsg] = useState<{ loading: boolean; warnings: string[] }>(() => {
    const p = new URLSearchParams(window.location.search);
    const hasParams = p.has("account") || p.has("repo") || p.has("pr") || p.has("env");
    return { loading: hasParams, warnings: [] };
  });

  // Auto-dismiss warnings after 8 seconds
  useEffect(() => {
    if (urlRestoreMsg.warnings.length === 0) return;
    const t = setTimeout(() => setUrlRestoreMsg((prev) => ({ ...prev, warnings: [] })), 8000);
    return () => clearTimeout(t);
  }, [urlRestoreMsg.warnings.length]);

  const addRestoreWarning = useCallback((msg: string) => {
    setUrlRestoreMsg((prev) => ({ ...prev, warnings: [...prev.warnings, msg] }));
  }, []);

  const checkRestoreDone = useCallback(() => {
    const p = pendingRestore.current;
    if (p.account === null && p.repo === null && p.pr === null && p.env === null)
      setUrlRestoreMsg((prev) => (prev.loading ? { ...prev, loading: false } : prev));
  }, []);

  return { urlRestoreMsg, setUrlRestoreMsg, pendingRestore, urlAccountApplied, addRestoreWarning, checkRestoreDone };
}
