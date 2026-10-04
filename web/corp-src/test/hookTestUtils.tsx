/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";

export function createHookHarness<T>(hook: () => T, onUpdate: (value: T) => void) {
  function Harness() {
    const value = hook();
    useEffect(() => {
      onUpdate(value);
    }, [value]);
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  return { root, container, Harness };
}

export async function waitFor(assertion: () => void, timeoutMs = 1500) {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
}
