/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";
import { MissingParam } from "../error/index.js";

app.http("createBranch", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const { owner, type, repo, source = "main", branch } = body;
      if (!owner || !type || !repo || !branch) {
        throw MissingParam();
      }

      const octokit = new Octokit({ auth: accessToken });
      const { data: originBranchData } = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        owner,
        repo,
        ref: `heads/${source}`,
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });
      const { data: newBranchData } = await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: originBranchData.object.sha,
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });
      return {
        jsonBody: {
          success: true,
          branch: { name: newBranchData.ref.replace("refs/heads/", ""), commit: newBranchData.object.sha },
        },
      };
    })
  ),
});
