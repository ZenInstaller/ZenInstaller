/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { app } from "@azure/functions";
import { Octokit } from "octokit";
import { requireAuth } from "../utils/auth.js";
import { corsWrapper } from "../utils/cors.js";

app.http("getOrgs", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: corsWrapper(
    requireAuth({ github: true })(async (request, context) => {
      const accessToken = request.auth.githubToken;
      const octokit = new Octokit({ auth: accessToken });
      const all = await octokit.paginate("GET /user/orgs", { per_page: 100 });
      const orgList = all.map((org) => ({ login: org.login, id: org.id }));
      return {
        jsonBody: { success: true, orgList },
      };
    })
  ),
});
