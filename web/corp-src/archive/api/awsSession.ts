import type { AwsCallerIdentity, AwsMfaDevice, AwsSessionCredentials } from "./aws";

const SESSION_STORAGE_KEY = "zeninstaller_aws_session";

export type StoredAwsTemporarySession = {
  identity: AwsCallerIdentity;
  mfaDevices: AwsMfaDevice[];
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: string };
};

export function saveAwsTemporarySession(
  identity: AwsCallerIdentity,
  mfaDevices: AwsMfaDevice[],
  creds: AwsSessionCredentials,
) {
  if (!creds.expiration) return;
  const payload: StoredAwsTemporarySession = {
    identity,
    mfaDevices,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      expiration: creds.expiration.toISOString(),
    },
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

export function loadAwsTemporarySession(): StoredAwsTemporarySession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAwsTemporarySession;
    if (new Date(parsed.credentials.expiration).getTime() <= Date.now()) {
      clearAwsSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getCurrentAwsSessionCredentials(): AwsSessionCredentials | null {
  const session = loadAwsTemporarySession();
  if (!session) return null;
  return { ...session.credentials, expiration: new Date(session.credentials.expiration) };
}

export function requireCurrentAwsSessionCredentials(): AwsSessionCredentials {
  const credentials = getCurrentAwsSessionCredentials();
  if (!credentials) throw new Error("Sign in to AWS first.");
  return credentials;
}

export function clearAwsSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}
