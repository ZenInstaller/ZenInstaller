/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("generateRepo", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const {
        isPrivate = true,
        includeAllBranch = false,
        owner,
        type,
        repo,
        createEnvs = true,
        templateRepo = "ZenMe-AU/ZenbloxCore",
        envNames = ["PROD", "TEST"],
      } = body;

      const [template_owner, template_repo] = templateRepo.split("/");

      const octokit = new Octokit({ auth: accessToken });
      const { data } = await octokit.request(`POST /repos/{template_owner}/{template_repo}/generate`, {
        template_owner,
        template_repo,
        owner,
        name: repo,
        include_all_branches: includeAllBranch,
        private: isPrivate,
        headers: {
          "X-GitHub-Api-Version": "2026-03-10",
        },
      });

      const repoResult = { name: data.name, id: data.id, full_name: data.full_name };
      const results = { repo: { name: data.full_name, success: true }, envs: [] };
      if (createEnvs) {
        const envs = Array.isArray(envNames) ? envNames : ["PROD", "TEST"];
        for (const envName of envs) {
          try {
            await octokit.request("PUT /repos/{owner}/{repo}/environments/{environment_name}", {
              owner,
              repo: data.name,
              environment_name: envName,
            });
            results.envs.push({ name: envName, success: true });
          } catch (err) {
            results.envs.push({ name: envName, success: false, error: err.message });
          }
        }
      }

      const success = results.envs.every((env) => env.success);
      const envSuccess = results.envs.length === 0 || results.envs.every((env) => env.success);
      return {
        jsonBody: { success, envSuccess, data: repoResult, results },
      };
    })
  ),
});
