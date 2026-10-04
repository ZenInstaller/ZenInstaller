/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { execSync } from "child_process";

export function buildFunctionApp({ cwd } = {}) {
  execSync("node build.js", { stdio: "inherit", shell: true, cwd });
}

export function zipFunctionApp({ outputName = "deploy.zip" }, { cwd } = {}) {
  execSync(`zip -r ${outputName} .`, {
    stdio: "inherit",
    shell: true,
    cwd,
  });
}

export function deployFunctionAppZip({ src, functionAppName, resourceGroupName }, { cwd } = {}) {
  return execSync(`az functionapp deployment source config-zip --src "${src}" --name ${functionAppName} --resource-group ${resourceGroupName}`, {
    stdio: "inherit",
    shell: true,
    cwd,
  });
}

export function deleteAppSetting({ functionAppName, resourceGroupName, settingName }, { cwd } = {}) {
  return execSync(
    `
      az functionapp config appsettings delete \
        --name ${functionAppName} \
        --resource-group ${resourceGroupName} \
        --setting-names ${settingName}
    `,
    {
      stdio: "inherit",
      shell: true,
      cwd,
    }
  );
}
