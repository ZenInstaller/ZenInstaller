/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("createVariable", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const { owner, repo, env, name, value } = body;

      const octokit = new Octokit({ auth: accessToken });

      await octokit.request("POST /repos/{owner}/{repo}/environments/{environment_name}/variables", {
        owner,
        repo,
        environment_name: env,
        name,
        value,
      });

      return {
        jsonBody: { success: true, name, env },
      };
    })
  ),
});
