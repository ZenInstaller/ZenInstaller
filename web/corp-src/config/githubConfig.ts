// ── GitHub OAuth app ──────────────────────────────────────────────────────────

export const GITHUB_PROVIDER = "github";
export const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID as string;
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_SCOPES = "read:user user:email repo";

// ── Where the sign-in leaves its state ────────────────────────────────────────

export const GITHUB_TOKEN_KEY = "github_access_token";
export const GITHUB_PAT_KEY = "github_pat_token";
export const GITHUB_VERIFIER_KEY = "github_pkce_verifier";

// OAuth first: a pasted personal access token is the fallback for whoever skipped the sign-in.
export const GITHUB_TOKEN_KEYS = [GITHUB_TOKEN_KEY, GITHUB_PAT_KEY] as const;
export type GithubTokenKey = (typeof GITHUB_TOKEN_KEYS)[number];

// ── What this installer sets up ───────────────────────────────────────────────

export const TEMPLATE_REPO: string = "ZenMe-AU/ZenbloxCore" as const;
export const VALID_ENVS: readonly string[] = ["PROD", "TEST"];
