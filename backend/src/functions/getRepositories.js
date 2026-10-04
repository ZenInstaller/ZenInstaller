/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getRepositories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const octokit = new Octokit({ auth: accessToken });
      const all = await octokit.paginate("GET /user/repos", { per_page: 100 });
      const repoList = all.map((repo) => ({
        name: repo.name,
        id: repo.id,
        full_name: repo.full_name,
        owner_id: repo.owner.id,
        owner: repo.owner.login,
        owner_type: repo.owner.type,
      }));
      return {
        jsonBody: { success: true, repoList },
      };
    })
  ),
});
