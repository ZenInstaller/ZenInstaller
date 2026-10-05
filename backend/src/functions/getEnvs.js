/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getEnvs", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const type = request.query.get("type");
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request(`GET /repos/{owner}/{repo}/environments`, { owner, repo });
      const envList = data.environments?.map((env) => ({ name: env.name, id: env.id, url: env.url }));
      return {
        jsonBody: { success: true, envList },
      };
    })
  ),
});
