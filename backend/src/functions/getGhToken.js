/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { corsWrapper } from "../utils/cors.js";
import { HttpError, MissingParam, InternalError } from "../error/index.js";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
// Used by the commented-out cookie path below.
// export const GITHUB_TOKEN_COOKIE = "gh_token";

/*
 * Exchanges an OAuth authorization code for a GitHub access token, and refreshes one.
 * This has to be server-side: GitHub requires client_secret
 */
app.http("getGhToken", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: corsWrapper(async (request) => {
    const body = await request.json();
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (!clientSecret) throw InternalError({ meta: { missing: "GITHUB_OAUTH_CLIENT_SECRET not set" } });

    const { client_id, code, code_verifier, redirect_uri, refresh_token } = body ?? {};
    if (!client_id) throw MissingParam({ meta: { required: ["client_id"] } });
    if (!code && !refresh_token) throw MissingParam({ meta: { required: ["code or refresh_token"] } });
    const form = refresh_token
      ? { client_id, client_secret: clientSecret, grant_type: "refresh_token", refresh_token }
      : { client_id, client_secret: clientSecret, code, code_verifier, redirect_uri };

    const res = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    // GitHub answers 200 with an error body rather than a status code, so the body decides.
    if (!res.ok || data.error) {
      throw new HttpError(400, data.error_description || data.error || "Token exchange failed");
    }

    /*
     * TODO: hand the token back as an HttpOnly cookie instead of in the body, so no script can read
     * it. Blocked on the Function App sharing a site with the frontend — today the frontend is on
     * the Pages domain and this is on *.azurewebsites.net, which makes the cookie third-party and
     * therefore blocked by default. Once this app answers on api.<same-domain>, swap the return
     * below for this and change getAccessToken in utils/auth.js to read the cookie.
     *
     * return {
     *   jsonBody: { ok: true, expires_in: data.expires_in ?? null, scope: data.scope ?? null },
     *   headers: {
     *     "Set-Cookie": [
     *       `${GITHUB_TOKEN_COOKIE}=${data.access_token}`,
     *       "HttpOnly",
     *       "Secure",
     *       "SameSite=Lax",
     *       "Path=/",
     *       `Max-Age=${data.expires_in ?? 8 * 3600}`,
     *       // `Domain=${process.env.AUTH_COOKIE_DOMAIN}`, // only to share across subdomains
     *     ].join("; "),
     *   },
     * };
     */

    // Deliberately narrowed: the secret and anything else GitHub returns stay on this side.
    return {
      jsonBody: {
        access_token: data.access_token,
        expires_in: data.expires_in ?? null,
        refresh_token: data.refresh_token ?? null,
        scope: data.scope ?? null,
      },
    };
  }),
});
