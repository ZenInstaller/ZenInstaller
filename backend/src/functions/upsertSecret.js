/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("upsertSecret", {
  methods: ["PUT"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;

      const body = await request.json();
      const { owner, repo, env, name, value, key, keyId } = body;

      const octokit = new Octokit({ auth: accessToken });

      const uri = env
        ? "PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}"
        : "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}";

      const params = {
        owner,
        repo,
        environment_name: env,
        secret_name: name,
        encrypted_value: value,
        key_id: keyId,
      };
      await octokit.request(uri, params);

      return {
        jsonBody: {
          success: true,
          name,
          env: env || "actions",
        },
      };
    })
  ),
});
