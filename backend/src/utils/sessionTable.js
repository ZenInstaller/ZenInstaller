/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { InternalError, NotFound, logError } from "../error/index.js";
import { TableClient } from "@azure/data-tables";
import { getAppCredential } from "./obo.js";

const SESSION_TABLE_ACCOUNT_NAME = process.env.SESSION_TABLE_ACCOUNT_NAME;
export const SESSION_TABLE_NAME = process.env.SESSION_TABLE_NAME || "sessions";
const SESSION_PARTITION_KEY = "session";

export function sessionTableResourceId() {
  if (process.env.SESSION_TABLE_RESOURCE_ID) return process.env.SESSION_TABLE_RESOURCE_ID;

  const subscriptionId = process.env.WEBSITE_OWNER_NAME?.split("+")[0];
  const resourceGroup = process.env.WEBSITE_RESOURCE_GROUP;
  if (!subscriptionId || !resourceGroup || !SESSION_TABLE_ACCOUNT_NAME) return null;

  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${SESSION_TABLE_ACCOUNT_NAME}`;
}

export function getTableClient() {
  if (!SESSION_TABLE_ACCOUNT_NAME) {
    throw InternalError({ meta: { missing: "SESSION_TABLE_ACCOUNT_NAME" } });
  }

  const url = `https://${SESSION_TABLE_ACCOUNT_NAME}.table.core.windows.net`;
  const credential = getAppCredential();
  // The table itself is created by the deployment terminal card, so it is assumed to exist here.
  return new TableClient(url, SESSION_TABLE_NAME, credential);
}

export async function saveSession(tableClient, { sessionId, accessToken, expiresAt }) {
  await tableClient.upsertEntity({ partitionKey: SESSION_PARTITION_KEY, rowKey: sessionId, accessToken, expiresAt }, "Replace");
}

export async function readSession(tableClient, sessionId) {
  let entity;
  try {
    entity = await tableClient.getEntity(SESSION_PARTITION_KEY, sessionId);
  } catch (err) {
    if (err?.statusCode === 404) throw NotFound({ cause: err, meta: { reason: "session_not_found" } });
    throw err;
  }
  return { accessToken: entity.accessToken, expiresAt: Number(entity.expiresAt) };
}

export async function deleteSessionEntity(tableClient, sessionId) {
  try {
    await tableClient.deleteEntity(SESSION_PARTITION_KEY, sessionId);
  } catch (err) {
    // Already gone is the outcome the caller wanted.
    if (err?.statusCode === 404) return;
    // Missing RBAC is never what anyone wanted, so the caller hears about it rather than a false success.
    if (err?.statusCode === 403) throw err;
    logError(err);
  }
}
