/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

/// <reference types="node" />

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const githubPatSetupFile = path.join(currentDirectory, "/pwtests/corp-src/setup/github-pat-login.setup.ts");
const githubBackendSetupFile = path.join(currentDirectory, "/pwtests/corp-src/setup/github-backend-login.setup.ts");
const azureSetupFile = path.join(currentDirectory, "/pwtests/corp-src/setup/azure-login.setup.ts");
export const authDir = path.join(currentDirectory, "../.auth");
export const githubStorageStateFile = path.join(authDir, "github-login.storage.json");
export const githubSessionStorageFile = path.join(authDir, "github-login.session.json");
export const azureStorageStateFile = path.join(authDir, "azure-login.storage.json");
export const azureSessionStorageFile = path.join(authDir, "azure-login.session.json");

export type CorpGithubAuthMode = "backend" | "direct";

export function getCorpGithubAuthMode(): CorpGithubAuthMode | null {
  if (!fs.existsSync(githubSessionStorageFile)) {
    return null;
  }

  try {
    const sessionStorage = JSON.parse(fs.readFileSync(githubSessionStorageFile, "utf-8")) as Record<string, string>;
    const auth = JSON.parse(sessionStorage.zeninstaller_github_auth ?? "null") as { mode?: string } | null;
    return auth?.mode === "backend" || auth?.mode === "direct" ? auth.mode : null;
  } catch {
    return null;
  }
}

export function corpGithubAuthStateExists(expectedMode?: CorpGithubAuthMode) {
  if (!fs.existsSync(githubStorageStateFile) || !fs.existsSync(githubSessionStorageFile)) {
    return false;
  }
  const mode = getCorpGithubAuthMode();
  return mode !== null && (expectedMode === undefined || mode === expectedMode);
}

export function corpAzureAuthStateExists() {
  return fs.existsSync(azureStorageStateFile) && fs.existsSync(azureSessionStorageFile);
}

async function saveSessionStorageTo(context: BrowserContext, targetFile: string) {
  const pages = context.pages();
  const page = pages[0];

  if (!page) {
    throw new Error("Cannot save Corp session storage because no page exists.");
  }

  const sessionStorageData = await page.evaluate(() => {
    return Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index);
        return key ? [key, sessionStorage.getItem(key) ?? ""] : null;
      }).filter((entry): entry is [string, string] => entry !== null)
    );
  });
  fs.writeFileSync(targetFile, JSON.stringify(sessionStorageData, null, 2));
}

async function restoreSessionStorageFrom(context: BrowserContext, sourceFile: string, error: string) {
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`${error}`);
  }

  const sessionStorageData = JSON.parse(fs.readFileSync(sourceFile, "utf-8")) as Record<string, string>;
  await context.addInitScript(
    ({ storage }) => {
      for (const [key, value] of Object.entries(storage)) {
        window.sessionStorage.setItem(key, value);
      }
    },
    { storage: sessionStorageData }
  );
}

export async function saveGithubSessionStorage(context: BrowserContext) {
  await saveSessionStorageTo(context, githubSessionStorageFile);
}

export async function restoreGithubSessionStorage(context: BrowserContext) {
  const error = `Github auth state does not exist. Please run the setup script to create it: ${githubPatSetupFile} or ${githubBackendSetupFile}.`;
  await restoreSessionStorageFrom(context, githubSessionStorageFile, error);
}

export async function saveAzureSessionStorage(context: BrowserContext) {
  await saveSessionStorageTo(context, azureSessionStorageFile);
}

export async function restoreAzureSessionStorage(context: BrowserContext) {
  const error = `Azure auth state does not exist. Please run the setup script to create it: ${azureSetupFile}.`;
  await restoreSessionStorageFrom(context, azureSessionStorageFile, error);
}
