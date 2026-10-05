/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { createHash } from "crypto";

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function updateKeyVaultSecrets(vaultName, secrets) {
  const url = `https://${vaultName}.vault.azure.net`;
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(url, credential);

  // Read only properties (name + tags) — secret values are never retrieved
  const existingProps = new Map();
  for await (const prop of client.listPropertiesOfSecrets()) {
    existingProps.set(prop.name, prop.tags ?? {});
  }

  for (const [name, value] of Object.entries(secrets)) {
    if (!value) {
      console.log(`  Skip (empty): ${name}`);
      continue;
    }

    const newHash = hashValue(value);
    const existing = existingProps.get(name);

    // Skip if hash tag matches — secret value never leaves Key Vault
    if (existing?.hash === newHash) {
      console.log(`  Skip (unchanged): ${name}`);
      continue;
    }

    // Set secret and store hash as tag (no GET needed on future runs)
    await client.setSecret(name, value, { tags: { hash: newHash } });
    console.log(`  Updated: ${name}`);
  }
}
