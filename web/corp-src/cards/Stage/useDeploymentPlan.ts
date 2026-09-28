import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchStageReport, getPlanEnv, triggerWorkflow } from "../../api";
import type { Account, Branch, GhEnv, PipelineConfig, PlanSummary, Stage, StageReport } from "../../types";

interface PollContext {
  attempt: number;
  triggerTime: number;
  stageKey: string;
  kind: "plan" | "deploy";
}

export interface StageRun {
  kind: "plan" | "deploy";
  countdown: number;
  retryCount: number;
  error: string | null;
}

export interface UseDeploymentPlan {
  latestSha?: string;
  stages: Stage[];
  stageSummaries: Record<string, PlanSummary>;
  hasPlan: boolean;
  stagesLoading: boolean;
  runs: Record<string, StageRun>;
  deployedEnv: Record<string, string> | null;
  // Both take just the stage key: the hook already holds the pipeline, the stages, the selected
  // env and the branches, so handing them back in would be a second source for the same value.
  onRun: (stageKey: string) => Promise<void>; // One card, one stage — never the whole pipeline.
  deployStage: (stageKey: string) => Promise<void>;
  setStageSummary: (key: string, summary: PlanSummary) => void;
}

const POLL_DELAYS = [150, 180, 200, 300];

export function useDeploymentPlan(opts: {
  account: Account | null;
  repoName: string | null;
  pipeline: PipelineConfig;
  selectedEnv: GhEnv | null;
  branches: Branch[];
  branchMatchError: string | null;
  envReady: boolean;
}): UseDeploymentPlan {
  const accountRef = useRef(opts.account);
  const repoNameRef = useRef(opts.repoName);
  const pipelineRef = useRef(opts.pipeline);
  const selectedEnvRef = useRef(opts.selectedEnv);
  const branchesRef = useRef(opts.branches);
  const envReadyRef = useRef(opts.envReady);
  useLayoutEffect(() => {
    accountRef.current = opts.account;
    repoNameRef.current = opts.repoName;
    pipelineRef.current = opts.pipeline;
    selectedEnvRef.current = opts.selectedEnv;
    branchesRef.current = opts.branches;
    envReadyRef.current = opts.envReady;
  });

  const [stages, setStages] = useState<Stage[]>([]);
  const stagesRef = useRef<Stage[]>([]);
  useLayoutEffect(() => {
    stagesRef.current = stages;
  });

  const [stageSummaries, setStageSummariesState] = useState<Record<string, PlanSummary>>({});
  const [hasPlan, setHasPlan] = useState(true);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [runs, setRuns] = useState<Record<string, StageRun>>({});
  const [deployedEnv, setDeployedEnv] = useState<Record<string, string> | null>(null);
  // One interval per stage, so a second card starting a run cannot cancel the first one's.
  const tickers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const patchRun = (stageKey: string, patch: Partial<StageRun> | null) =>
    setRuns((prev) => {
      if (!patch) {
        const rest = { ...prev };
        delete rest[stageKey];
        return rest;
      }
      const base = prev[stageKey] ?? { kind: "plan", countdown: 0, retryCount: 0, error: null };
      return { ...prev, [stageKey]: { ...base, ...patch } };
    });

  const stopTicker = (stageKey: string) => {
    clearInterval(tickers.current[stageKey]);
    delete tickers.current[stageKey];
  };
  useEffect(() => () => Object.keys(tickers.current).forEach(stopTicker), []);
  const lastFetchedEnvId = useRef<number | null>(null);

  const implRef = useRef<{
    loadPlanImpl: (ref: string, poll?: PollContext) => void;
    startPollingImpl: (
      ref: string,
      attempt: number,
      triggerTime: number,
      stageKey: string,
      kind: "plan" | "deploy",
    ) => void;
  }>({ loadPlanImpl: () => {}, startPollingImpl: () => {} });

  const startPollingImpl = (
    ref: string,
    attempt: number,
    triggerTime: number,
    stageKey: string,
    kind: "plan" | "deploy",
  ) => {
    const delay = POLL_DELAYS[attempt] ?? POLL_DELAYS[POLL_DELAYS.length - 1];
    stopTicker(stageKey);
    patchRun(stageKey, { kind, countdown: delay });
    let remaining = delay;
    tickers.current[stageKey] = setInterval(() => {
      remaining -= 1;
      patchRun(stageKey, { countdown: remaining });
      if (remaining <= 0) {
        stopTicker(stageKey);
        implRef.current.loadPlanImpl(ref, { attempt, triggerTime, stageKey, kind });
      }
    }, 1000);
  };

  const loadPlanImpl = (ref: string, poll?: PollContext) => {
    const acc = accountRef.current;
    const repo = repoNameRef.current;
    const pipe = pipelineRef.current;
    const envName = selectedEnvRef.current?.name;
    if (!acc || !repo || !envName) return;

    if (!poll) setStagesLoading(true);
    const load = (dir: string, kind: "plan" | "deploy") =>
      fetchStageReport(acc, repo, envName, dir, kind).catch((e) => {
        console.error(`Failed to fetch the ${kind} report for "${dir}":`, e);
        return null;
      });

    Promise.all(
      pipe.stages.map(async (stageDef) => {
        const [plan, deploy] = await Promise.all([load(stageDef.dir, "plan"), load(stageDef.dir, "deploy")]);
        return [stageDef.dir, { plan, deploy }] as const;
      }),
    )
      .then((entries) => {
        const byKey = new Map(entries);
        if (!poll) setStagesLoading(false);

        const nothingReported = ![...byKey.values()].some((r) => r.plan || r.deploy);

        if (poll) {
          const reported = byKey.get(poll.stageKey)?.[poll.kind]?.createdAt ?? 0;
          if (reported <= poll.triggerTime) {
            const next = poll.attempt + 1;
            if (next >= POLL_DELAYS.length) {
              patchRun(poll.stageKey, {
                retryCount: next,
                countdown: 0,
                error: "Workflow is taking too long. Please check GitHub Actions.",
              });
            } else {
              patchRun(poll.stageKey, { retryCount: next });
              implRef.current.startPollingImpl(ref, next, poll.triggerTime, poll.stageKey, poll.kind);
            }
          } else {
            patchRun(poll.stageKey, null);
          }
        }

        if (nothingReported) {
          setStages(pipe.stages.map(({ dir }) => ({ stage: dir, status: "pending" as const })));
          setHasPlan(false);
          return;
        }

        // The env artifact belongs to whichever plan reported most recently across the pipeline.
        const newest = [...byKey.values()]
          .map((r) => r.plan)
          .filter((r): r is StageReport => !!r)
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        const envId = typeof newest?.stage.envId === "number" ? newest.stage.envId : null;
        if (envId && envId !== lastFetchedEnvId.current) {
          lastFetchedEnvId.current = envId;
          getPlanEnv(acc, repo, envId).then(setDeployedEnv).catch(console.error);
        }

        setStages(
          pipe.stages.map(({ dir }) => {
            const { plan, deploy } = byKey.get(dir) ?? { plan: null, deploy: null };
            if (!plan && !deploy) return { stage: dir, status: "pending" as const };
            // The plan deployment owns the plan fields, the deploy one owns the deploy fields.
            // planSha is named explicitly so the deploy report's own sha cannot overwrite it.
            return { ...plan?.stage, ...deploy?.stage, stage: dir, planSha: plan?.sha } as Stage;
          }),
        );
        setHasPlan(true);
      })
      .catch((e) => {
        console.error("Failed to load the stage reports:", e);
        if (!poll) setStagesLoading(false);
        if (poll) patchRun(poll.stageKey, { countdown: 0, error: "Could not read the stage reports" });
        setStages(pipe.stages.map(({ dir }) => ({ stage: dir, status: "pending" as const })));
        setHasPlan(false);
      });
  };

  useLayoutEffect(() => {
    implRef.current.loadPlanImpl = loadPlanImpl;
    implRef.current.startPollingImpl = startPollingImpl;
  });

  useEffect(() => {
    Object.keys(tickers.current).forEach(stopTicker);
    setRuns({});
    setStages([]);
    setStageSummariesState({});
    setHasPlan(true);
    setDeployedEnv(null);
    setStagesLoading(false);
    lastFetchedEnvId.current = null;
  }, [opts.selectedEnv?.id]);

  useEffect(() => {
    if (!opts.selectedEnv || opts.branchMatchError) return;
    const branch = branchesRef.current.find((b) => b.name.toLowerCase() === opts.selectedEnv!.name.toLowerCase());
    if (branch) implRef.current.loadPlanImpl(branch.name);
  }, [opts.selectedEnv?.id, opts.branchMatchError]);

  const onRun = useCallback(async (stageKey: string) => {
    const acc = accountRef.current;
    const repo = repoNameRef.current;
    const env = selectedEnvRef.current;
    const stage = pipelineRef.current.stages.find((s) => s.dir === stageKey);
    if (!acc || !repo || !envReadyRef.current || !env || !stage) return;
    const triggerTime = Date.now();
    patchRun(stageKey, { kind: "plan", countdown: 0, retryCount: 0, error: null });

    try {
      await triggerWorkflow(acc, repo, stage.workflowId, env.name, env.name);
    } catch (e) {
      console.error("Failed to trigger workflow:", e);
      patchRun(stageKey, { error: "Failed to trigger workflow", countdown: 0 });
      return;
    }

    const matchedBranch = branchesRef.current.find((b) => b.name.toLowerCase() === env.name.toLowerCase());
    if (!matchedBranch) {
      patchRun(stageKey, { error: `No branch found matching env "${env.name}"`, countdown: 0 });
      return;
    }
    implRef.current.startPollingImpl(matchedBranch.name, 0, triggerTime, stageKey, "plan");
  }, []);

  // Watches for the deploy report. The remote terminal is what actually dispatches the run.
  const deployStage = useCallback(async (stageKey: string) => {
    const acc = accountRef.current;
    const repo = repoNameRef.current;
    const env = selectedEnvRef.current;
    const stageDef = pipelineRef.current.stages.find((s) => s.dir === stageKey);
    const stage = stagesRef.current.find((s) => s.stage === stageKey);
    if (!acc || !repo || !env || !stageDef || !stage?.runId) return;

    patchRun(stageKey, { kind: "deploy", countdown: 0, retryCount: 0, error: null });

    const triggerTime = Date.now();
    // Same branch lookup onRun does, from the same ref. onRun treats no match as an error while
    // this falls back to the env name — left as it was rather than changed in passing.
    const ref = branchesRef.current.find((b) => b.name.toLowerCase() === env.name.toLowerCase())?.name ?? env.name;
    implRef.current.startPollingImpl(ref, 0, triggerTime, stageKey, "deploy");
  }, []);

  const setStageSummary = useCallback((key: string, summary: PlanSummary) => {
    setStageSummariesState((prev) => ({ ...prev, [key]: summary }));
  }, []);

  const latestSha = opts.branches.find((b) => b.name.toLowerCase() === opts.selectedEnv?.name.toLowerCase())?.commit;

  return {
    latestSha,
    stages,
    stageSummaries,
    hasPlan,
    stagesLoading,
    runs,
    deployedEnv,
    onRun,
    deployStage,
    setStageSummary,
  };
}
