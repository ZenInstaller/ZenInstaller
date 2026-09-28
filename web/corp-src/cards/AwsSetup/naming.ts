// Mirrors ZBCorpArchitecture util/namingConvention.cjs — keep in sync.

// The repo segment of GitHub's immutable OIDC subject; "@" can't appear in an org or repo name.
export function getImmutableRepoSegment(org: string, orgId: number, repo: string, repoId: number): string {
  return `repo:${org}@${orgId}/${repo}@${repoId}`;
}

// The OIDC sub claim a GitHub Actions run emits — matched verbatim by Entra and by AWS IAM alike.
export function getFederatedSubject(
  org: string,
  orgId: number,
  repo: string,
  repoId: number,
  environment: string,
): string {
  return `${getImmutableRepoSegment(org, orgId, repo, repoId)}:environment:${environment}`;
}
