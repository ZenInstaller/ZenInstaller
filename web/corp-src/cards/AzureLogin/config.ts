/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

const DOCS_BASE = "/docs";

// TODO: Investige if we should remove redundant cloud-docs wrapper.
export const CLOUD_DOCS = {
  azure: {
    createAccount: `${DOCS_BASE}/Creating_AZURE_account`,
    setupOidc: `${DOCS_BASE}/Set_up_GitHub_oidc_for_AZURE`,
    urlGetTenantId: "https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/Overview",
  },
} as const;
