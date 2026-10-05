/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";
import { MissingParam } from "../error/index.js";

app.http("triggerActions", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const { workflow_id, ref, type, owner, repo, github_env_name, run_id, plan_run_id, dir, session_id } = body;
      if (!ref || !type || !owner || !repo || !workflow_id || !github_env_name) {
        throw new MissingParam();
      }
      if (workflow_id === "deployPlan.yml" && (!plan_run_id || !dir)) {
        throw new MissingParam();
      }
      if (workflow_id === "deployChangeset.yml" && (!run_id || !dir)) {
        throw new MissingParam();
      }
      if (workflow_id === "remoteLogin.yml" && (!session_id || !dir || !plan_run_id)) {
        throw new MissingParam();
      }

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request(`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`, {
        owner,
        repo,
        workflow_id,
        ref,
        inputs: { github_env_name, run_id, plan_run_id, dir, session_id },
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });

      return {
        jsonBody: { success: true, id: data.workflow_run_id },
      };
    })
  ),
});
