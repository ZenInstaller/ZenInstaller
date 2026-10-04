/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getUser", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request) => {
      const octokit = new Octokit({ auth: request.auth.githubToken });
      const { data } = await octokit.request("GET /user");
      return {
        jsonBody: { success: true, user: { login: data.login, id: data.id } },
      };
    })
  ),
});
