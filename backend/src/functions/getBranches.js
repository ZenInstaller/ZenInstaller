/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getBranches", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const octokit = new Octokit({ auth: accessToken });
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      // const type = request.query.get("type");

      const all = await octokit.paginate("GET /repos/{owner}/{repo}/branches", { owner, repo, per_page: 100 });
      const branchList = all.map((branch) => ({
        name: branch.name,
        commit: branch.commit.sha,
        protected: branch.protected,
      }));
      return {
        jsonBody: { success: true, branches: branchList },
      };
    })
  ),
});
