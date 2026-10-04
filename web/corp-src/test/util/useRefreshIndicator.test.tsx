/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useRefreshIndicator, type RefreshResult } from "../../hooks/util/useRefreshIndicator";

function HookHarness(props: { busy: boolean; failed?: boolean; onUpdate: (value: { refreshResult: RefreshResult; markClicked: () => void }) => void }) {
  const value = useRefreshIndicator(props.busy, props.failed);
  useEffect(() => {
    props.onUpdate(value);
  }, [value, props]);
  return null;
}

describe("useRefreshIndicator", () => {
  it("shows a transient result after a busy refresh completes", async () => {
    vi.useFakeTimers();
    let latest: { refreshResult: RefreshResult; markClicked: () => void } | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          busy={true}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    await act(async () => {
      latest?.markClicked();
    });

    await act(async () => {
      root.render(
        <HookHarness
          busy={false}
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    expect(latest?.refreshResult).toBe("done");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(latest?.refreshResult).toBe(null);

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });

  it("reports failed when a clicked refresh ends in error", async () => {
    vi.useFakeTimers();
    let latest: { refreshResult: RefreshResult; markClicked: () => void } | null = null;
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <HookHarness
          busy={true}
          failed
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });
    await act(async () => {
      latest?.markClicked();
    });
    await act(async () => {
      root.render(
        <HookHarness
          busy={false}
          failed
          onUpdate={(value) => {
            latest = value;
          }}
        />
      );
    });

    expect(latest?.refreshResult).toBe("failed");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(latest?.refreshResult).toBe(null);

    await act(async () => {
      root.unmount();
    });
    vi.useRealTimers();
  });
});
