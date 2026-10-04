/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { updateKeyVaultSecrets } from "./keyvault.js";
import { buildFunctionApp, zipFunctionApp, deployFunctionAppZip, deleteAppSetting } from "./functionApp.js";
import { execSync } from "child_process";
import { resolve } from "path";
import { exit } from "process";

function getCurrentSubscription() {
  return execSync(`az account show --query id -o tsv`, { encoding: "utf8" }).trim();
}

function switchSubscription(subscriptionId) {
  console.log(`Switching to subscription: ${subscriptionId}`);
  execSync(`az account set --subscription ${subscriptionId}`, { stdio: "inherit" });
}

export async function runDeploy(config) {
  const { subscriptionId, vaultName, secretList, functionAppName, resourceGroupName, appCwd } = config;

  try {
    console.log("Step 0: Check subscription");
    const currentSub = getCurrentSubscription();
    if (subscriptionId && currentSub !== subscriptionId) {
      console.log("Current subscription:", currentSub);
      switchSubscription(subscriptionId);
    }

    console.log("Step 1: Update Key Vault");
    await updateKeyVaultSecrets(vaultName, secretList);

    console.log("Step 2: pnpm deploy (flat, prod-only)");
    const outputDirName = "dist";
    const distCwd = `${appCwd}/${outputDirName}`;
    const workspaceCwd = resolve(appCwd, "..");
    execSync(`rm -rf "${distCwd}"`, { stdio: "inherit", shell: true });
    execSync(`pnpm run backend:deploy`, { stdio: "inherit", shell: true, cwd: workspaceCwd, env: { ...process.env, DEPLOY_OUT: distCwd } });
    console.log("Step 3: Zip");
    const zipName = "deploy.zip";
    zipFunctionApp({ outputName: zipName }, { cwd: distCwd });

    console.log("Step 4: Delete old app settings");
    deleteAppSetting({ functionAppName, resourceGroupName, settingName: "AzureWebJobsStorage" });

    console.log("Step 5: Deploy");
    deployFunctionAppZip(
      {
        src: zipName,
        functionAppName,
        resourceGroupName,
      },
      { cwd: distCwd }
    );

    console.log("Deploy success");
  } catch (err) {
    console.error("Deploy failed:", err);
    throw err;
  }
}
