/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Forbidden, Unauthorized } from "../error/index.js";
import { assertRoles } from "./rbac.js";

export const GH_TOKEN_HEADER = "Zb.Github.Authorization";
export const MS_TOKEN_HEADER = "Zb.Msal.Authorization";

// Both token headers follow the Authorization convention, so the scheme is required, not optional.
function readBearer(request, header) {
  const value = request.headers.get(header)?.trim();
  if (!value) return null;
  const [scheme, ...rest] = value.split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return null;
  return rest.join(" ") || null;
}

/**
 * Returns the GitHub access token for the current request.
 *
 * The browser signs in with PKCE and holds the token, so it arrives as a bearer header.
 * GITHUB_TOKEN in local.settings.json skips the OAuth flow entirely during development.
 */
export function getAccessToken(request) {
  /*
   * TODO: prefer the HttpOnly cookie once the Function App is on the same site as the frontend —
   * see the matching block in functions/getGhToken.js. Reading it first makes the bearer path
   * below a fallback for anything still sending one.
   *
   * const cookie = request.headers.get("cookie") ?? "";
   * const fromCookie = cookie.match(/(?:^|;\s*)gh_token=([^;]+)/)?.[1];
   * if (fromCookie) return decodeURIComponent(fromCookie);
   */

  const ghHeader = readBearer(request, GH_TOKEN_HEADER);
  if (ghHeader) return ghHeader;

  const devToken = process.env.GITHUB_TOKEN;
  if (devToken) return devToken;

  throw Unauthorized({ meta: { reason: "not_authenticated" } });
}

// Same as getAccessToken but null instead of throwing, for callers that decide for themselves.
function tryGetAccessToken(request) {
  try {
    return getAccessToken(request);
  } catch {
    return null;
  }
}

export function getMsToken(request) {
  return readBearer(request, MS_TOKEN_HEADER);
}

/*
 * Declares the sign-ins an endpoint needs, so each function states its own requirement instead of
 * repeating the checks. What was found is attached to the request as `auth`:
 *
 *   handler: corsWrapper(requireAuth({ github: true })(async (request) => {
 *     const octokit = new Octokit({ auth: request.auth.githubToken });
 *   }))
 *
 * `{ github: true, ms: true }` demands both. `check` is for anything beyond "is this person signed
 * in" — return false to refuse.
 */
export function requireAuth({ github = false, ms = false, msRbac, check } = {}) {
  return (handler) => async (request, context) => {
    const githubToken = tryGetAccessToken(request);
    const msToken = getMsToken(request); // check for presence only: the OBO exchange validates it

    if (github && !githubToken) throw Unauthorized({ meta: { reason: "github_token_missing" } });
    // only check for presence; the actual validation happens during rbac checks.
    if (ms && !msToken) throw Unauthorized({ meta: { reason: "microsoft_token_missing" } });
    // Azure enforces its own roles where a call runs as the caller; this is for the calls that do not.
    if (msRbac?.length) await assertRoles(msToken, msRbac);

    // Attached to the request so handlers keep the signature Azure Functions expects.
    request.auth = { githubToken, msToken };
    if (check && !(await check(request.auth, request))) throw Forbidden({ meta: { reason: "not_permitted" } });

    return handler(request, context);
  };
}
