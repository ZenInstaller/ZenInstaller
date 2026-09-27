import type {
  Account,
  CardChrome,
  CardHook,
  CardId,
  CardStatus,
  GhEnv,
  PipelineConfig,
  PlanSummary,
  Stage,
  StageDefinition,
} from "../../types";
import type { UseDeploymentPlan } from "./useDeploymentPlan";
import {
  getEffectiveStatus,
  getStageCardId,
  getStageSummaryText,
  hasVariableDiff,
  stageToCardStatus,
} from "../../logic/stage";

export type CorpStageCardModel = {
  key: string;
  card: CardChrome;
  stageDef: StageDefinition;
  stage: Stage;
  deployDisabled: boolean;
  deployedEnv: Record<string, string> | null;
  variableValues: Record<string, string>;
  cardStatus: Record<CardId, CardStatus>;
  account: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  onVariableConfirmed: (key: string, value: string) => void;
  trackDeploy?: () => Promise<void>;
  onPlanSummary: (s: PlanSummary) => void;
  onRunStatusUpdate: () => Promise<void>;
  statusUpdateRunning: boolean;
  statusUpdateCountdown: number;
  statusUpdateDisabled: boolean;
  runError: string | null;
};

export function useCorpStageCards({
  pipeline,
  plan,
  allCards,
  repoDone,
  repoDependencyLabel,
  expandedIds,
  account,
  repoName,
  selectedEnv,
  variableValues,
  onVariableConfirmed,
  onToggle,
  onRequirementClick,
}: {
  pipeline: PipelineConfig;
  plan: UseDeploymentPlan;
  allCards: Record<string, CardHook>;
  repoDone: boolean;
  repoDependencyLabel?: string | null;
  expandedIds: Set<CardId>;
  account: Account | null;
  repoName: string;
  selectedEnv: GhEnv | null;
  variableValues: Record<string, string>;
  onVariableConfirmed: (key: string, value: string) => void;
  onToggle: (id: CardId) => void;
  onRequirementClick: (id: CardId) => void;
}): CorpStageCardModel[] {
  const cardStatus = Object.fromEntries(Object.entries(allCards).map(([id, hook]) => [id, hook.status])) as Record<
    CardId,
    CardStatus
  >;

  return pipeline.stages.map((stageDef: StageDefinition) => {
    const stage = plan.stages.find((s) => s.stage === stageDef.dir) ?? {
      stage: stageDef.dir,
      status: "pending" as const,
    };
    const summary = plan.stageSummaries[stageDef.dir];
    const effectiveStatus = getEffectiveStatus(stage, summary, stageDef.optional);
    const varsMismatch =
      plan.deployedEnv != null && hasVariableDiff(stageDef.prerequisites, variableValues, plan.deployedEnv);
    // This stage's own run, if it has one — a run on another card must not grey this one out.
    const run = plan.runs[stageDef.dir];
    const isStale = run != null;
    const deployDisabled = isStale || varsMismatch;
    const cardId = getStageCardId(stageDef.dir);
    const requirements = repoDone
      ? []
      : [
          {
            label: repoDependencyLabel ?? "Repository & environment",
            target: "repo" as CardId,
          },
        ];
    const locked = requirements.length > 0;
    const card: CardChrome = {
      cardId,
      status: locked ? "idle" : stageToCardStatus(effectiveStatus, isStale, plan.stagesLoading),
      summary: locked ? undefined : getStageSummaryText(stage, summary, plan.stagesLoading, isStale, stageDef.optional),
      locked,
      requirements,
      unavailable: false,
      expanded: expandedIds.has(cardId),
      onToggle: () => onToggle(cardId),
      onRequirementClick,
    };
    const trackDeploy =
      effectiveStatus === "success" && stage.runId && selectedEnv
        ? async () => {
            await plan.deployStage(stageDef.dir);
          }
        : undefined;

    return {
      key: stageDef.dir,
      card,
      stageDef,
      stage,
      latestSha: plan.latestSha,
      deployDisabled,
      deployedEnv: plan.deployedEnv,
      variableValues,
      cardStatus,
      account,
      repoName,
      selectedEnv,
      onVariableConfirmed,
      trackDeploy,
      onPlanSummary: (s) => plan.setStageSummary(stageDef.dir, s),
      onRunStatusUpdate: () => plan.onRun(stageDef.dir),
      statusUpdateRunning: run != null && run.error == null,
      statusUpdateCountdown: run?.countdown ?? 0,
      statusUpdateDisabled: !repoDone || run != null,
      runError: run?.error ?? null,
    };
  });
}
