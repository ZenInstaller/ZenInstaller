/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const env = parse(readFileSync(resolve(root, ".env"), "utf8"));

const target = env.TARGET_ENV?.trim();
if (!target) throw new Error("TARGET_ENV is required in .env");
if (!env.SUBSCRIPTION_ID?.trim()) throw new Error("SUBSCRIPTION_ID is required in .env");

// Derive all resource names from TARGET_ENV
// storage account: remove dashes, lowercase, append "storage"  (e.g. zb-installer → zbinstallerstorage)
const storageAccountName = target.replace(/-/g, "").toLowerCase() + "storage";

const tfvars = {
  subscription_id: env.SUBSCRIPTION_ID.trim(),
  ...(env.LOCATION?.trim() ? { location: env.LOCATION.trim() } : {}),
  resource_group_name: `${target}-rg`,
  log_analytics_workspace_name: `${target}-law`,
  application_insights_name: `${target}-ai`,
  key_vault_name: `${target}-kv`,
  storage_account_name: storageAccountName,
  function_app_name: `${target}-app`,
  allowed_origins: env.ALLOWED_ORIGINS?.trim() ?? "",
  oauth_secret: "", // placeholder — actual value is managed via Key Vault by deployer.js
};

const outPath = resolve(root, "env/terraform.auto.tfvars.json");
writeFileSync(outPath, JSON.stringify(tfvars, null, 2) + "\n");

console.log("Generated env/terraform.auto.tfvars.json");
console.log(JSON.stringify(tfvars, null, 2));
