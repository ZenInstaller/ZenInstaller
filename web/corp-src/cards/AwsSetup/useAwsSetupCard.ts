import { useCallback, useState } from "react";
import { createOrUpdateGithubOidcRole, ensureGithubOidcProvider } from "../../api/aws";
import { getFederatedSubject } from "./naming";
import type { AwsCallerIdentity } from "../../api/aws";
import { PIPELINE } from "../../logic/pipeline";
import { AWS_VARIABLE_KEYS } from "../../logic/variables";
import type { CardHook, CardStatus } from "../../types";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";
export type SetupStep = { id: string; label: string; status: StepStatus; detail?: string };

export type UseAwsSetupCardParams = {
  githubAccount: string;
  githubAccountId: number;
  githubRepo: string;
  githubRepoId: number | null;
  variableValues: Record<string, string>;
  awsReady: boolean;
  awsAccount: AwsCallerIdentity | null;
};

export type UseAwsSetupCard = CardHook & {
  readonly cardId: "aws_setup";
  roleName: string;
  setRoleName: (value: string) => void;
  environments: string[];
  setEnvironments: (value: string[]) => void;
  toggleEnv: (env: string) => void;
  loading: boolean;
  steps: SetupStep[];
  roleArn: string | null;
  wasUpdated: boolean | null;
  error: string | null;
  canCreate: boolean;
  create: () => Promise<void>;
  resetRoleCreation: () => void;
};

export function useAwsSetupCard({
  githubAccount,
  githubAccountId,
  githubRepo,
  githubRepoId,
  variableValues,
  awsReady,
  awsAccount,
}: UseAwsSetupCardParams): UseAwsSetupCard {
  const defaultEnvs = ["PROD", "TEST"].filter((e) => PIPELINE.validEnvs.includes(e));
  const [roleName, setRoleName] = useState("zeninstaller-github");
  const [environments, setEnvironments] = useState<string[]>(
    defaultEnvs.length > 0 ? defaultEnvs : [...PIPELINE.validEnvs],
  );
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [roleArn, setRoleArn] = useState<string | null>(null);
  const [wasUpdated, setWasUpdated] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateStep = useCallback((id: string, status: StepStatus, detail?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status, detail } : s)));
  }, []);

  const toggleEnv = (env: string) =>
    setEnvironments((prev) => (prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]));

  const savedRoleArn = variableValues[AWS_VARIABLE_KEYS[0]]?.trim() ?? "";
  const done = !!savedRoleArn;
  const canCreate =
    awsReady && !!awsAccount && !!roleName.trim() && environments.length > 0 && !!githubAccount && !!githubRepo;

  const resetRoleCreation = () => {
    setSteps([]);
    setRoleArn(null);
    setWasUpdated(null);
    setError(null);
  };

  const create = async () => {
    if (!awsReady || !awsAccount) {
      setError("Sign in to AWS first.");
      return;
    }
    setLoading(true);
    setError(null);

    const initialSteps: SetupStep[] = [
      { id: "oidc", label: "Check Identity provider", status: "pending" },
      { id: "role", label: "Create IAM role", status: "pending" },
    ];
    setSteps(initialSteps);

    let currentStep = "oidc";
    try {
      updateStep("oidc", "running");
      const { created } = await ensureGithubOidcProvider();
      updateStep("oidc", "done", created ? "Created" : "Already exists");

      currentStep = "role";
      updateStep("role", "running");
      if (githubRepoId === null) throw new Error(`Create the repository ${githubRepo} on GitHub before running this`);
      const { roleArn: arn, updated } = await createOrUpdateGithubOidcRole({
        accountId: awsAccount.accountId,
        org: githubAccount,
        repo: githubRepo,
        subjects: environments.map((env) =>
          getFederatedSubject(githubAccount, githubAccountId, githubRepo, githubRepoId, env),
        ),
        roleName,
      });
      updateStep("role", "done", updated ? `Existing role — merged ${environments.length} environment(s)` : "Created");
      setRoleArn(arn);
      setWasUpdated(updated);
    } catch (err) {
      updateStep(currentStep, "error", err instanceof Error ? err.message : "Failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const status: CardStatus = done ? "complete" : awsReady ? "warning" : "idle";
  const summary = done
    ? "Connection details already filled in"
    : awsReady
      ? "Create the AWS IAM role"
      : "Set up AWS connection";

  return {
    cardId: "aws_setup",
    roleName,
    setRoleName,
    environments,
    setEnvironments,
    toggleEnv,
    loading,
    steps,
    roleArn,
    wasUpdated,
    error,
    canCreate,
    create,
    resetRoleCreation,
    status,
    summary,
    cardRequirements: ["aws_login", "repo"],
    cardDependencyLabel: "Set up AWS connection",
    done,
  };
}
