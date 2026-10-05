/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useEffect } from "react";
import { useStepRunner } from "../../hooks/util/useStepRunner";
import type { SetupStep } from "../../types";

function HookHarness(props: { onUpdate: (value: ReturnType<typeof useStepRunner>) => void }) {
  const value = useStepRunner();
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

describe("useStepRunner", () => {
  it("tracks steps and running state", async () => {
    let latest: ReturnType<typeof useStepRunner> | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      latest?.setSteps([{ id: "one", label: "Step one", status: "pending" } as SetupStep]);
      latest?.setRunning(true);
    });

    expect(latest?.running).toBe(true);
    expect(latest?.steps).toEqual([{ id: "one", label: "Step one", status: "pending" }]);

    await act(async () => {
      latest?.updateStep("one", "done", "Complete");
      latest?.resetSteps();
    });

    expect(latest?.steps).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });
});
