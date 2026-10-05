/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { useCallback } from "react";
import { getProviderRegistrationState, registerProvider } from "../../api/azureArm";
import type { AzureAccount } from "../../types";

const POLL_START_MS = 2000;
const POLL_MAX_MS = 15_000;
const POLL_FACTOR = 1.5;
const TIMEOUT_MS = 180_000;

export type UseProviderRegistrationParams = {
  azureAccount: AzureAccount | null;
  subscriptionId: string;
  tenantId?: string;
};

export function useProviderRegistration({ azureAccount, subscriptionId, tenantId }: UseProviderRegistrationParams) {
  // Resolves to the namespaces this call actually had to register; already-registered ones are omitted.
  const ensureRegistered = useCallback(
    async (namespaces: readonly string[]): Promise<{ registered: string[] }> => {
      if (!azureAccount || !subscriptionId || namespaces.length === 0) return { registered: [] };

      const registerOne = async (namespace: string): Promise<boolean> => {
        if ((await getProviderRegistrationState(azureAccount, subscriptionId, namespace, tenantId)) === "Registered") {
          return false;
        }
        await registerProvider(azureAccount, subscriptionId, namespace, tenantId);

        const start = Date.now();
        let delay = POLL_START_MS;
        for (;;) {
          await new Promise((r) => setTimeout(r, delay));
          if ((await getProviderRegistrationState(azureAccount, subscriptionId, namespace, tenantId)) === "Registered") {
            return true;
          }
          if (Date.now() - start > TIMEOUT_MS) throw new Error(`Timed out registering resource provider ${namespace}`);
          delay = Math.min(delay * POLL_FACTOR, POLL_MAX_MS);
        }
      };

      // Parallel: namespaces register independently, so one slow provider shouldn't serialise the rest.
      const results = await Promise.all(namespaces.map(async (ns) => ({ ns, registered: await registerOne(ns) })));
      return { registered: results.filter((r) => r.registered).map((r) => r.ns) };
    },
    [azureAccount, subscriptionId, tenantId]
  );

  return { ensureRegistered };
}
