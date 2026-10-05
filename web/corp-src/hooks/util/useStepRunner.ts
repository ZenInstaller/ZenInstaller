/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { SetupStep } from "../../types";

/*
 * The progress-checklist state every AzureConfigHook card needs: the step list, the
 * running flag, and the by-id updater their run() walks through. Not card-facing —
 * AzureConfigHook in types.ts is the public shape; this exposes the mutable primitives
 * a concrete hook's own run()/reset() drives.
 */
export function useStepRunner(): {
  steps: SetupStep[];
  setSteps: Dispatch<SetStateAction<SetupStep[]>>;
  running: boolean;
  setRunning: Dispatch<SetStateAction<boolean>>;
  updateStep: (id: string, status: SetupStep["status"], detail?: string, progress?: number) => void;
  resetSteps: () => void;
} {
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [running, setRunning] = useState(false);

  const updateStep = useCallback((id: string, status: SetupStep["status"], detail?: string, progress?: number) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, detail, progress } : s)));
  }, []);

  const resetSteps = useCallback(() => setSteps([]), []);

  return { steps, setSteps, running, setRunning, updateStep, resetSteps };
}
