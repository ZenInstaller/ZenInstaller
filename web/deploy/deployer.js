/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { runDeploy } from "./delivery/index.js";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from deploy/
config({ path: resolve(__dirname, ".env") });

const appCwd = resolve(__dirname, "../backend");
const tfvars = JSON.parse(fs.readFileSync(resolve(__dirname, "env/terraform.auto.tfvars.json"), "utf8"));

await runDeploy({
  subscriptionId: tfvars.subscription_id,
  vaultName: tfvars.key_vault_name,
  secretList: {
    "oauth-secret": process.env.GITHUB_OAUTH_CLIENT_SECRET,
  },
  functionAppName: tfvars.function_app_name,
  resourceGroupName: tfvars.resource_group_name,
  appCwd,
});
