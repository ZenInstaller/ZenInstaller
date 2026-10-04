/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("deleteVariable", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const { owner, repo, env, name } = body;

      const octokit = new Octokit({ auth: accessToken });

      await octokit.request("DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}", {
        owner,
        repo,
        environment_name: env,
        name,
      });

      return {
        jsonBody: { success: true, name, env },
      };
    })
  ),
});
