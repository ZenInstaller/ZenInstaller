import { STSClient, GetSessionTokenCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  ListMFADevicesCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  CreateOpenIDConnectProviderCommand,
  GetRoleCommand,
  UpdateAssumeRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  SESSION_DURATION_SECONDS,
  GITHUB_OIDC_URL,
  GITHUB_OIDC_THUMBPRINTS,
  GITHUB_OIDC_AUD_CONDITION_KEY,
  GITHUB_OIDC_SUB_CONDITION_KEY,
} from "../config/awsConfig";
import { requireCurrentAwsSessionCredentials } from "./awsSession";

// AWS calls made directly from the browser with the user's own credentials — no
// backend involved. STS/IAM support signed cross-origin requests, so the whole
// sign-in + role-creation flow can run client-side.

export type AwsSessionCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration?: Date;
};

export type AwsCallerIdentity = {
  accountId: string;
  arn: string;
  username: string;
};

export type AwsMfaDevice = {
  serialNumber: string;
  name: string;
  // true = TOTP (virtual app / hardware token) → GetSessionToken accepts a 6-digit code.
  // false = FIDO security key (u2f) → console-only, unusable for STS/CLI credentials.
  usable: boolean;
};

// Resolves who the given long-term credentials belong to, for a "signed in as …" display.
export async function getAwsCallerIdentity(accessKeyId: string, secretAccessKey: string): Promise<AwsCallerIdentity> {
  const sts = new STSClient({ region: "us-east-1", credentials: { accessKeyId, secretAccessKey } });
  const { Account, Arn } = await sts.send(new GetCallerIdentityCommand({}));
  if (!Account || !Arn) throw new Error("Failed to resolve AWS caller identity");
  return { accountId: Account, arn: Arn, username: Arn.split("/").pop() ?? Arn };
}

// Lists the user's registered MFA devices. Empty array means no MFA is enrolled.
// The ARN resource type distinguishes TOTP (arn:…:mfa/<name>, usable via STS) from
// FIDO security keys (arn:…:u2f/…, console-only). The friendly name is the last segment.
export async function getAwsMfaDevices(accessKeyId: string, secretAccessKey: string): Promise<AwsMfaDevice[]> {
  const iam = new IAMClient({ region: "us-east-1", credentials: { accessKeyId, secretAccessKey } });
  const { MFADevices } = await iam.send(new ListMFADevicesCommand({}));
  return (MFADevices ?? [])
    .filter((d) => d.SerialNumber)
    .map((d) => {
      const serial = d.SerialNumber;
      const resourceType = serial.split(":").pop()?.split("/")[0] ?? "";
      return { serialNumber: serial, name: serial.split("/").pop() ?? serial, usable: resourceType === "mfa" };
    });
}

export async function getAwsSessionCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  mfa?: { serialNumber: string; tokenCode: string },
): Promise<AwsSessionCredentials> {
  const sts = new STSClient({ region: "us-east-1", credentials: { accessKeyId, secretAccessKey } });
  const session = await sts.send(
    new GetSessionTokenCommand({
      DurationSeconds: SESSION_DURATION_SECONDS,
      ...(mfa ? { SerialNumber: mfa.serialNumber, TokenCode: mfa.tokenCode } : {}),
    }),
  );
  const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = session.Credentials ?? {};
  if (!AccessKeyId || !SecretAccessKey || !SessionToken) {
    throw new Error("Failed to obtain temporary credentials from AWS STS");
  }
  return {
    accessKeyId: AccessKeyId,
    secretAccessKey: SecretAccessKey,
    sessionToken: SessionToken,
    expiration: Expiration,
  };
}

// ─── IAM role for GitHub Actions OIDC ───────────────────────────────────────────
// Split into two calls (provider, then role) so the hook can drive a step-by-step
// progress display, the same way the Azure app-registration flow does.

type TrustPolicyStatement = {
  Effect: string;
  Principal: { Federated: string };
  Action: string;
  Condition: {
    StringEquals: Record<string, string>;
    StringLike: Record<string, string | string[]>;
  };
};

type TrustPolicyDocument = { Version: string; Statement: TrustPolicyStatement[] };

const isAwsError = (err: unknown, name: string): boolean => err instanceof Error && err.name === name;

// Registers GitHub Actions as an OIDC identity provider in IAM. Idempotent —
// reports whether it already existed vs was just created.
export async function ensureGithubOidcProvider(): Promise<{ created: boolean }> {
  const credentials = requireCurrentAwsSessionCredentials();
  const iam = new IAMClient({ region: "us-east-1", credentials });
  try {
    await iam.send(
      new CreateOpenIDConnectProviderCommand({
        Url: GITHUB_OIDC_URL,
        ClientIDList: ["sts.amazonaws.com"],
        ThumbprintList: GITHUB_OIDC_THUMBPRINTS,
      }),
    );
    return { created: true };
  } catch (err) {
    if (isAwsError(err, "EntityAlreadyExistsException")) return { created: false };
    throw err;
  }
}

export type CreateAwsIamRoleParams = {
  accountId: string;
  org: string;
  repo: string;
  subjects: string[]; // OIDC sub claims to trust — built by the caller from logic/naming.
  roleName: string;
};

// Creates (or updates the trust policy of) an IAM role that GitHub Actions can assume
// via OIDC — no long-lived AWS secrets stored in GitHub. Idempotent: re-running with
// additional environments merges them into the existing trust policy.
export async function createOrUpdateGithubOidcRole({
  accountId,
  org,
  repo,
  subjects,
  roleName,
}: CreateAwsIamRoleParams): Promise<{ roleArn: string; updated: boolean }> {
  const credentials = requireCurrentAwsSessionCredentials();
  const iam = new IAMClient({ region: "us-east-1", credentials });

  const oidcProviderArn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;
  const newSubs = subjects;

  const newStatement: TrustPolicyStatement = {
    Effect: "Allow",
    Principal: { Federated: oidcProviderArn },
    Action: "sts:AssumeRoleWithWebIdentity",
    Condition: {
      StringEquals: { [GITHUB_OIDC_AUD_CONDITION_KEY]: "sts.amazonaws.com" },
      StringLike: { [GITHUB_OIDC_SUB_CONDITION_KEY]: newSubs },
    },
  };

  let roleArn: string;
  let updated = false;

  try {
    const createRes = await iam.send(
      new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [newStatement] }),
        Description: `GitHub Actions OIDC role for ${org}/${repo}`,
      }),
    );
    if (!createRes.Role?.Arn) throw new Error("AWS did not return a role ARN");
    roleArn = createRes.Role.Arn;
  } catch (err) {
    if (!isAwsError(err, "EntityAlreadyExistsException")) throw err;

    // Role exists — merge selected environments into the trust policy.
    const existing = await iam.send(new GetRoleCommand({ RoleName: roleName }));
    if (!existing.Role?.Arn) throw new Error("Failed to resolve existing role ARN");
    roleArn = existing.Role.Arn;

    let existingPolicyObj: TrustPolicyDocument | null = null;
    try {
      existingPolicyObj = existing.Role.AssumeRolePolicyDocument
        ? (JSON.parse(decodeURIComponent(existing.Role.AssumeRolePolicyDocument)) as TrustPolicyDocument)
        : null;
    } catch {
      existingPolicyObj = null;
    }

    let mergedPolicy: TrustPolicyDocument;
    if (existingPolicyObj) {
      // Find an existing GitHub OIDC statement to merge subs into.
      const githubStmt = existingPolicyObj.Statement?.find(
        (s) => s.Condition?.StringLike?.[GITHUB_OIDC_SUB_CONDITION_KEY] !== undefined,
      );
      if (githubStmt) {
        const existingSubs = ([] as string[]).concat(githubStmt.Condition.StringLike[GITHUB_OIDC_SUB_CONDITION_KEY]);
        githubStmt.Condition.StringLike[GITHUB_OIDC_SUB_CONDITION_KEY] = [...new Set([...existingSubs, ...newSubs])];
      } else {
        // Unrecognized trust policy structure — append a new statement.
        existingPolicyObj.Statement = [...(existingPolicyObj.Statement ?? []), newStatement];
      }
      mergedPolicy = existingPolicyObj;
    } else {
      // Unparseable document — replace with minimal policy containing our statement.
      mergedPolicy = { Version: "2012-10-17", Statement: [newStatement] };
    }

    await iam.send(
      new UpdateAssumeRolePolicyCommand({ RoleName: roleName, PolicyDocument: JSON.stringify(mergedPolicy) }),
    );
    updated = true;
  }

  // Idempotent — safe to call even if the policy is already attached.
  await iam.send(
    new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess" }),
  );

  return { roleArn, updated };
}
