// ── Session-token lifetime ──────────────────────────────────────────────────────
// Kept short to limit how long the exchanged session credentials remain valid.
// Non-MFA sessions are refreshed silently near expiry (the long-term keys stay in
// memory); MFA sessions can't be — each GetSessionToken needs a fresh one-time
// code — so they lapse and re-prompt.

export const SESSION_DURATION_SECONDS = 15 * 60;
export const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;

// Refresh non-MFA sessions this many ms before expiry so a call never lands on a
// just-expired token.
export const SESSION_REFRESH_LEAD_MS = 30_000;

// ── GitHub Actions OIDC federation (AWS side) ───────────────────────────────────
// Well-known values for registering GitHub Actions as an OIDC identity provider
// in IAM, so workflows can assume a role via `AssumeRoleWithWebIdentity` instead
// of long-lived secrets. Thumbprints are GitHub's OIDC TLS chain root fingerprints.

export const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_THUMBPRINTS = [
  "6938fd4d98bab03faadb97b34396831e3780aea1",
  "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
];
export const GITHUB_OIDC_AUD_CONDITION_KEY = "token.actions.githubusercontent.com:aud";
export const GITHUB_OIDC_SUB_CONDITION_KEY = "token.actions.githubusercontent.com:sub";
