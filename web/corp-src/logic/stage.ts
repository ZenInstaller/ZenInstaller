/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import type {
  ActionType,
  CardId,
  CardStatus,
  PlanItem,
  PlanSummary,
  Prerequisite,
  PrerequisiteStageVar,
  PrerequisiteVar,
  PrerequisiteVarGroup,
  Stage,
  StageReport,
  StageStatus,
} from "../types";

// The Deployments API types payload as object-or-string, so both shapes have to parse.
export function toStageReport(payload: unknown, createdAt: string, sha?: string): StageReport | null {
  let data: unknown = payload;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const at = new Date(createdAt).getTime();
  return { stage: data as Stage, createdAt: Number.isNaN(at) ? 0 : at, sha };
}

export function getStageCardId(stageKey: string): CardId {
  return `stage_${stageKey}`;
}

export function getActionType(actions: string[]): ActionType {
  if (actions.includes("delete") && actions.includes("create")) return "replace";
  if (actions.includes("create")) return "create";
  if (actions.includes("delete")) return "delete";
  if (actions.includes("update")) return "update";
  if (actions.includes("no-op")) return "noOp";
  return "unknown";
}

export function computePlanSummary(items: PlanItem[]): PlanSummary {
  return items.reduce(
    (acc, item) => {
      const t = getActionType(item.change.actions);
      if (t === "create") acc.create++;
      if (t === "update") acc.update++;
      if (t === "delete") acc.delete++;
      if (t === "replace") acc.replace++;
      return acc;
    },
    { create: 0, update: 0, delete: 0, replace: 0 }
  );
}

export function isNoChanges(summary?: PlanSummary): boolean {
  return summary != null && summary.create === 0 && summary.update === 0 && summary.delete === 0 && summary.replace === 0;
}

export function getEffectiveStatus(stage: Stage, summary?: PlanSummary, isOptional?: boolean): StageStatus {
  // The deploy records its plan run whatever the outcome, so the status has to be checked too —
  // a failed or cancelled apply must stay "success" and keep offering Deploy.
  if (stage.deployStatus === "success" && stage.deployPlanRunId && stage.runId && stage.deployPlanRunId === stage.runId) return "deployed";
  if (isNoChanges(summary)) return "deployed";
  if (isOptional && stage.status === "pending") return "skipped";
  return stage.status;
}

// A plan produced from an older commit may not reflect what is on the branch now.
export function isPlanBehind(stage: Stage, latestSha?: string): boolean {
  return !!stage.planSha && !!latestSha && stage.planSha !== latestSha;
}

export function getStageSummaryText(stage: Stage, summary: PlanSummary | undefined, loading: boolean, stale: boolean, optional?: boolean): string {
  if (stale) return "Status update required";
  if (loading) return "Loading status...";
  if (isNoChanges(summary)) return "No changes";
  const effectiveStatus = getEffectiveStatus(stage, summary, optional);
  return (
    {
      deployed: "Deployed",
      success: "Ready to deploy",
      failed: "Failed",
      pending: "Not yet executed",
      skipped: "Skipped",
    } as Record<StageStatus, string>
  )[effectiveStatus];
}

export function stageToCardStatus(effectiveStatus: StageStatus, isStale: boolean, isLoading: boolean): CardStatus {
  if (isStale) return "idle";
  if (isLoading) return "loading";
  if (effectiveStatus === "deployed") return "complete";
  if (effectiveStatus === "success") return "warning";
  if (effectiveStatus === "failed") return "error";
  if (effectiveStatus === "skipped") return "skipped";
  return "idle";
}

export function hasVariableDiff(prerequisites: Prerequisite[], currentVars: Record<string, string>, deployedEnv: Record<string, string>): boolean {
  return prerequisites.some((p) => {
    if (p.type === "var") return (currentVars[(p as PrerequisiteVar).key] ?? "") !== (deployedEnv[(p as PrerequisiteVar).key] ?? "");
    if (p.type === "varGroup" || p.type === "stageVar")
      return (p as PrerequisiteVarGroup | PrerequisiteStageVar).keys.some((k) => (currentVars[k] ?? "") !== (deployedEnv[k] ?? ""));
    return false;
  });
}
