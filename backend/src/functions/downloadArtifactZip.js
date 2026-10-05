/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

// TODO: merge with downloadArtifacts
app.http("downloadArtifactZip", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request) => {
      const accessToken = request.auth.githubToken;

      const artifacts_id = request.query.get("artifacts_id");
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      const ref = request.query.get("ref") ?? "main";

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/actions/artifacts/{artifacts_id}/zip", {
        owner,
        repo,
        artifacts_id,
        ref,
        headers: { "X-GitHub-Api-Version": "2026-03-10" },
      });

      const zip = Buffer.from(data);
      return {
        body: zip,
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(zip.byteLength),
          // Without this the browser cannot read Content-Length cross-origin, so no progress total.
          "Access-Control-Expose-Headers": "Content-Length",
        },
      };
    })
  ),
});
