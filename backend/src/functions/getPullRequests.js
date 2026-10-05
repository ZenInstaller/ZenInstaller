/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getPullRequests", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      const ref = request.query.get("ref") ?? "main";
      const state = "open";
      console.log("Fetching pull requests for ", { owner, repo, ref });
      const octokit = new Octokit({ auth: accessToken });
      const all = await octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo,
        state,
        per_page: 100,
        // base: ref,
        // head: `${owner}:${ref}`
      });
      const pullRequestList = all.map(({ id, number, title, state, html_url, base, head }) => ({
        id,
        number,
        title,
        state,
        html_url,
        base_branch: base.ref,
        base_sha: base.sha,
        head_branch: head.ref,
        head_sha: head.sha,
      }));
      return {
        jsonBody: { success: true, pullRequests: pullRequestList },
      };
    })
  ),
});
