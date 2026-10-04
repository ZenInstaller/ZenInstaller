/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getRepos", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const type = request.query.get("type");
      const owner = request.query.get("owner");

      const octokit = new Octokit({ auth: accessToken });
      const uri = type === "User" ? "GET /user/repos" : "GET /orgs/{org}/repos";
      const params = type === "User" ? { per_page: 100 } : { org: owner, per_page: 100 };
      const all = await octokit.paginate(uri, params);
      const repoList = all.filter((repo) => repo.owner.type === type).map((repo) => ({ name: repo.name, id: repo.id, full_name: repo.full_name }));
      return {
        jsonBody: { success: true, repoList },
      };
    })
  ),
});
