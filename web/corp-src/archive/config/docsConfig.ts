const DOCS_BASE = "/docs";

// TODO: Investige if we should remove redundant cloud-docs wrapper.
export const CLOUD_DOCS = {
  aws: {
    createAccount: `${DOCS_BASE}/Creating_AWS_account`,
    setupOidc: `${DOCS_BASE}/Set_up_GitHub_oidc_for_AWS`,
    bootstrapCredentials: `${DOCS_BASE}/Create_AWS_bootstrap_credentials`,
  },
} as const;
