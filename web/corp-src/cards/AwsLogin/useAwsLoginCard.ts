import { useCallback, useEffect, useRef, useState } from "react";
import { getAwsCallerIdentity, getAwsMfaDevices, getAwsSessionCredentials } from "../../api/aws";
import type { AwsCallerIdentity, AwsMfaDevice } from "../../api/aws";
import { clearAwsSession, loadAwsTemporarySession, saveAwsTemporarySession } from "../../api/awsSession";
import { SESSION_DURATION_MS, SESSION_REFRESH_LEAD_MS } from "../../config/awsConfig";
import type { CardHook, CardStatus, LoginHook } from "../../types";

export type UseAwsLoginCard = CardHook &
  LoginHook<AwsCallerIdentity> & {
    readonly cardId: "aws_login";
    accessKeyId: string;
    setAccessKeyId: (value: string) => void;
    secretAccessKey: string;
    setSecretAccessKey: (value: string) => void;
    mfaDevices: AwsMfaDevice[];
    selectedMfaSerial: string | null;
    setSelectedMfaSerial: (value: string | null) => void;
    mfaTokenCode: string;
    setMfaTokenCode: (value: string) => void;
    needsMfa: boolean;
    fidoOnly: boolean;
    signInError: string | null;
    canSignIn: boolean;
  };

export function useAwsLoginCard(): UseAwsLoginCard {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [restoredSession] = useState(loadAwsTemporarySession);

  const [identity, setIdentity] = useState<AwsCallerIdentity | null>(restoredSession?.identity ?? null);
  const [mfaDevices, setMfaDevices] = useState<AwsMfaDevice[]>(restoredSession?.mfaDevices ?? []);
  const [selectedMfaSerial, setSelectedMfaSerial] = useState<string | null>(null);
  const [mfaTokenCode, setMfaTokenCode] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [sessionValidUntil, setSessionValidUntil] = useState<number | null>(
    restoredSession ? new Date(restoredSession.credentials.expiration).getTime() : null,
  );

  const signedIn = sessionValidUntil !== null && sessionValidUntil > Date.now();
  const usableMfa = mfaDevices.filter((d) => d.usable);
  const needsMfa = identity !== null && usableMfa.length > 0 && !signedIn;
  const fidoOnly = identity !== null && mfaDevices.length > 0 && usableMfa.length === 0;

  const resetSession = useCallback(() => {
    setSessionValidUntil(null);
    setIdentity(null);
    setMfaDevices([]);
    setSelectedMfaSerial(null);
    setMfaTokenCode("");
    setSignInError(null);
    clearAwsSession();
  }, []);

  const previousLongTermCredentialsRef = useRef({ accessKeyId, secretAccessKey });
  useEffect(() => {
    const previous = previousLongTermCredentialsRef.current;
    if (previous.accessKeyId !== accessKeyId || previous.secretAccessKey !== secretAccessKey) {
      previousLongTermCredentialsRef.current = { accessKeyId, secretAccessKey };
      resetSession();
    }
  }, [accessKeyId, secretAccessKey, resetSession]);

  useEffect(() => {
    if (sessionValidUntil === null) return;
    const isMfa = mfaDevices.some((d) => d.usable);
    const canRefresh = !!accessKeyId.trim() && !!secretAccessKey.trim();
    const lead = isMfa || !canRefresh ? 0 : SESSION_REFRESH_LEAD_MS;
    const delay = Math.max(0, sessionValidUntil - Date.now() - lead);
    const timer = setTimeout(async () => {
      if (isMfa || !canRefresh) {
        setSessionValidUntil(null);
        clearAwsSession();
        return;
      }
      try {
        const creds = await getAwsSessionCredentials(accessKeyId.trim(), secretAccessKey.trim());
        setSessionValidUntil(creds.expiration ? creds.expiration.getTime() : Date.now() + SESSION_DURATION_MS);
        if (identity) saveAwsTemporarySession(identity, mfaDevices, creds);
      } catch {
        setSessionValidUntil(null);
        clearAwsSession();
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [sessionValidUntil, mfaDevices, accessKeyId, secretAccessKey, identity]);

  const exchangeSession = async (forIdentity: AwsCallerIdentity, forDevices: AwsMfaDevice[]) => {
    const mfa =
      selectedMfaSerial && mfaTokenCode.trim()
        ? { serialNumber: selectedMfaSerial, tokenCode: mfaTokenCode.trim() }
        : undefined;
    const creds = await getAwsSessionCredentials(accessKeyId.trim(), secretAccessKey.trim(), mfa);
    setSessionValidUntil(creds.expiration ? creds.expiration.getTime() : Date.now() + SESSION_DURATION_MS);
    setMfaTokenCode("");
    saveAwsTemporarySession(forIdentity, forDevices, creds);
  };

  const login = async () => {
    setSignInError(null);
    setSigningIn(true);
    try {
      if (!identity) {
        const [id, devices] = await Promise.all([
          getAwsCallerIdentity(accessKeyId.trim(), secretAccessKey.trim()),
          getAwsMfaDevices(accessKeyId.trim(), secretAccessKey.trim()),
        ]);
        setIdentity(id);
        setMfaDevices(devices);
        const firstUsable = devices.find((d) => d.usable);
        setSelectedMfaSerial(firstUsable?.serialNumber ?? null);
        if (firstUsable) return;
        await exchangeSession(id, devices);
        return;
      }

      if (usableMfa.length > 0 && !mfaTokenCode.trim()) {
        setSignInError("Enter your MFA code to continue.");
        return;
      }
      await exchangeSession(identity, mfaDevices);
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const logout = () => resetSession();
  const canSignIn = !!accessKeyId.trim() && !!secretAccessKey.trim() && (!needsMfa || !!mfaTokenCode.trim());
  const status: CardStatus = signedIn ? "complete" : identity ? "warning" : "idle";
  const summary = signedIn
    ? `Signed in as ${identity?.username ?? "AWS"}`
    : identity
      ? "MFA verification required"
      : "Connect your AWS account";

  return {
    // cardHook
    cardId: "aws_login",
    status,
    summary,
    cardRequirements: [],
    cardDependencyLabel: "Sign in to AWS",
    done: signedIn,
    // loginHook
    account: identity,
    loggingIn: signingIn,
    login,
    logout,
    refresh: () => {},
    // extra
    accessKeyId,
    setAccessKeyId,
    secretAccessKey,
    setSecretAccessKey,
    mfaDevices,
    selectedMfaSerial,
    setSelectedMfaSerial,
    mfaTokenCode,
    setMfaTokenCode,
    needsMfa,
    fidoOnly,
    signInError,
    canSignIn,
  };
}
