/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ZenInstaller Docs",
  description: "ZenInstaller documentation and guides",
  base: "/docs/",
  ignoreDeadLinks: [/^\/scripts\//],
  themeConfig: {
    sidebar: [
      {
        items: [
          {
            text: "Allow Zeninstaller access to GitHub",
            link: "/Allow_access_to_GitHub.md",
          },
          {
            text: "Creating AZURE account",
            link: "/Creating_AZURE_account",
          },
          {
            text: "Set up GitHub oidc for AZURE",
            link: "/Set_up_GitHub_oidc_for_AZURE",
          },
          {
            text: "Creating AWS account",
            link: "/Creating_AWS_account",
          },
          {
            text: "Create AWS bootstrap credentials",
            link: "/Create_AWS_bootstrap_credentials",
          },
          {
            text: "Set up GitHub oidc for AWS",
            link: "/Set_up_GitHub_oidc_for_AWS",
          },
        ],
      },
    ],
    socialLinks: [],
    outline: {
      level: [2, 3],
    },
  },
});
