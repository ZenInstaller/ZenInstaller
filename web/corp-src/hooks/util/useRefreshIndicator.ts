/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from "react";

export type RefreshResult = "done" | "failed" | null;

/*
 * Transient "Refresh → Done/Failed → (clears)" indicator shared by every refresh
 * button. Call markClicked() before refreshing; clears itself 1.5s after busy ends.
 */
export function useRefreshIndicator(busy: boolean, failed?: boolean) {
  const prevBusy = useRef(false);
  const clicked = useRef(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult>(null);

  useEffect(() => {
    const was = prevBusy.current;
    prevBusy.current = busy;
    if (was && !busy && clicked.current) {
      clicked.current = false;
      setRefreshResult(failed ? "failed" : "done");
      const t = setTimeout(() => setRefreshResult(null), 1500);
      return () => clearTimeout(t);
    }
  }, [busy, failed]);

  return {
    refreshResult,
    markClicked: () => {
      clicked.current = true;
    },
  };
}
