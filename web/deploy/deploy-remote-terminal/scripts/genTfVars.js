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
// storage account: remove dashes, lowercase, append "storage"  (e.g. zen-terminal → zenterminalstorage)
const storageAccountName = target.replace(/-/g, "").toLowerCase() + "storage";
if (storageAccountName.length > 24) {
  throw new Error(`Storage account name "${storageAccountName}" is ${storageAccountName.length} chars; Azure allows 24. Shorten TARGET_ENV.`);
}

// No sensible default: a wrong sub claim produces a principal that can never authenticate.
const subjects = (env.GITHUB_OIDC_SUBJECTS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
if (subjects.length === 0) {
  throw new Error(
    'GITHUB_OIDC_SUBJECTS is required in .env — copy the exact "subject" from an existing federated credential on the pipeline repo, comma separated for each environment'
  );
}

const tfvars = {
  subscription_id: env.SUBSCRIPTION_ID.trim(),
  ...(env.LOCATION?.trim() ? { location: env.LOCATION.trim() } : {}),
  resource_group_name: `${target}-rg`,
  log_analytics_workspace_name: `${target}-law`,
  application_insights_name: `${target}-ai`,
  storage_account_name: storageAccountName,
  web_pubsub_name: `${target}-wps`,
  function_app_name: `${target}-app`,
  pipeline_app_name: `${target}-pipeline`,
  github_oidc_subjects: subjects,
  ...(env.HUB_NAME?.trim() ? { hub_name: env.HUB_NAME.trim() } : {}),
  ...(env.WEB_PUBSUB_SKU?.trim() ? { web_pubsub_sku: env.WEB_PUBSUB_SKU.trim() } : {}),
  allowed_origins: env.ALLOWED_ORIGINS?.trim() ?? "",
};

const outPath = resolve(root, "env/terraform.auto.tfvars.json");
writeFileSync(outPath, JSON.stringify(tfvars, null, 2) + "\n");

console.log("Generated env/terraform.auto.tfvars.json");
console.log(JSON.stringify(tfvars, null, 2));
