/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getDeployments", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;
      const owner = request.query.get("owner");
      const repo = request.query.get("repo");
      const environment = request.query.get("environment");
      const task = request.query.get("task");
      const perPage = Number(request.query.get("per_page") ?? 1);

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/deployments", {
        owner,
        repo,
        environment,
        task,
        per_page: perPage,
      });

      // Only what the card reads — the rest of a deployment is noise here.
      return {
        jsonBody: {
          success: true,
          deployments: data.map((d) => ({ id: d.id, task: d.task, payload: d.payload, created_at: d.created_at })),
        },
      };
    })
  ),
});
