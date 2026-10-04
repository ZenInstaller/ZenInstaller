/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { ConfidentialClientApplication } from "@azure/msal-node";
import { AuthenticationError, CredentialUnavailableError, DefaultAzureCredential, ManagedIdentityCredential } from "@azure/identity";
import { Forbidden, InternalError, Unauthorized, logError } from "../error/index.js";

/*
 * UNUSED for now:
 * now the browser sends an ARM token
 */

// The audience every workload identity federation token is issued for.
const FEDERATION_SCOPE = "api://AzureADTokenExchange/.default";

const TENANT_ID = process.env.FUNCTION_TENANT_ID;
const CLIENT_ID = process.env.FUNCTION_CLIENT_ID;
const CLIENT_SECRET = process.env.FUNCTION_CLIENT_SECRET; // Local only

function clientCredential() {
  if (CLIENT_SECRET) return { clientSecret: CLIENT_SECRET };
  const functionIdentity = new ManagedIdentityCredential();
  // A callback rather than a value: the managed identity's token expires, so it is fetched per use.
  return { clientAssertion: async () => (await functionIdentity.getToken(FEDERATION_SCOPE)).token };
}

let client = null;

function getClient() {
  const missing = [!TENANT_ID && "FUNCTION_TENANT_ID", !CLIENT_ID && "FUNCTION_CLIENT_ID"].filter(Boolean);
  if (missing.length) throw InternalError({ meta: { missing } });

  // msal-node keeps its own token cache, so a burst of calls from one person costs one exchange.
  if (!client) {
    client = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        ...clientCredential(),
      },
    });
  }
  return client;
}

// OAuth draws the line: invalid_client is us failing to authenticate, invalid_grant is the user's token.
function isOurFault(err) {
  if (err instanceof CredentialUnavailableError || err instanceof AuthenticationError) return true;
  return err?.errorCode === "invalid_client";
}

// On-behalf-of: trades the token for downstream Azure resource as the same user.
export async function getOboToken(userToken, scopes) {
  // Outside the try: missing configuration is our fault, and must not surface as the caller's 401.
  const client = getClient();

  let result;
  try {
    result = await client.acquireTokenOnBehalfOf({ oboAssertion: userToken, scopes });
  } catch (err) {
    // Logged here because toHttpResponse drops the cause, and the AADSTS code lives in it.
    logError(err);
    if (isOurFault(err)) throw InternalError({ cause: err, meta: { reason: "function_identity_failed" } });
    // Not a bad token — the user or an admin has not yet consented to the downstream permission.
    if (err?.subError === "consent_required") throw Forbidden({ cause: err, meta: { reason: "consent_required", scopes } });
    throw Unauthorized({ cause: err, meta: { reason: "obo_exchange_failed", scopes } });
  }

  if (!result?.accessToken) {
    throw InternalError({ meta: { reason: "obo_returned_no_token", scopes } });
  }
  return result.accessToken;
}

// Only to tell the SDK when to stop reusing it; a wrong guess costs a refused call, not a wrong one.
function expiryOf(token) {
  try {
    const [, payload] = token.split(".");
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number.isFinite(exp)) return exp * 1000;
  } catch {
    // Not a readable JWT; let the SDK treat it as short-lived.
  }
  return Date.now() + 5 * 60 * 1000;
}

// ── The one piece still in use ────────────────────────────────────────────────

let appCredential = null;
// Every Azure call runs as this app; requireAuth checks the caller's own grant beforehand.
export function getAppCredential() {
  return (appCredential ??= new DefaultAzureCredential());
}

// With the caller's token, act as them via OBO for the resource `scopes` names.
export async function getCredential(scopes, userToken) {
  if (!userToken) throw InternalError({ meta: { reason: "user_token_required" } });

  const token = await getOboToken(userToken, scopes);
  return { getToken: async () => ({ token, expiresOnTimestamp: expiryOf(token) }) };
}
