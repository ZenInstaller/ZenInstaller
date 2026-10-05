/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getSecrets", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      const env = request.query.get("env");

      const octokit = new Octokit({ auth: accessToken });

      const uri = env ? "GET /repos/{owner}/{repo}/environments/{environment_name}/secrets" : "GET /repos/{owner}/{repo}/actions/secrets";
      const params = { owner, repo, environment_name: env, per_page: 100 };
      console.log("uri:", uri);
      console.log("Requesting secrets with params:", params);
      const secretList = await octokit.paginate(uri, params, (res) => res.data?.map(({ name }) => name) ?? []);
      return {
        jsonBody: { success: true, secrets: secretList },
      };
    })
  ),
});
