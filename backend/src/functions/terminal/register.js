/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { requireAuth } from "../../utils/auth.js";
import { corsWrapper } from "../../utils/cors.js";
import { HttpError, MissingParam } from "../../error/index.js";
import { getTableClient, saveSession } from "../../utils/sessionTable.js";

app.http("register", {
  methods: ["POST"],
  route: "terminal/register",
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ ms: true, msRbac: ["Storage Table Data Contributor"] })(async (request, context) => {
      const body = await request.json();
      const sessionId = body?.sessionId;
      const accessToken = body?.accessToken;
      const ttlSeconds = Number(body?.ttlSeconds || 1800);
      if (!sessionId || !accessToken) {
        throw MissingParam({ meta: { required: ["sessionId", "accessToken"] } });
      }

      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new HttpError(400, "ttlSeconds must be a positive number", { meta: { ttlSeconds } });
      }

      const expiresAt = Date.now() + ttlSeconds * 1000;
      const tableClient = getTableClient();
      await saveSession(tableClient, { sessionId, accessToken, expiresAt });
      context.log(`Session registered: ${sessionId} (TTL ${ttlSeconds}s)`);
      return { jsonBody: { ok: true } };
    })
  ),
});
