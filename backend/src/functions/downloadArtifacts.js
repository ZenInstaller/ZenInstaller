/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

// TODO: merge with downloadArtifactZip
app.http("downloadArtifacts", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const artifacts_id = request.query.get("artifacts_id");
      const type = request.query.get("type");
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      const ref = request.query.get("ref") ?? "main";

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/actions/artifacts/{artifacts_id}/zip", {
        owner,
        repo,
        artifacts_id,
        ref,
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });
      const content = Buffer.from(data).toString("base64");
      return {
        jsonBody: { success: true, content },
      };
    })
  ),
});
