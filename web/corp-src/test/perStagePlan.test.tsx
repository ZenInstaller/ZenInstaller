import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PIPELINE } from "../logic/pipeline";
import type { Account, Branch, GhEnv } from "../types";

const apiMocks = vi.hoisted(() => ({
  triggerWorkflow: vi.fn(),
  fetchStageReport: vi.fn(),
  getPlanEnv: vi.fn(),
}));
vi.mock("../api", () => apiMocks);

const { useDeploymentPlan } = await import("../cards/Stage/useDeploymentPlan");
type Plan = ReturnType<typeof useDeploymentPlan>;

const ACCOUNT = { login: "org-one", type: "Organization", id: 1 } as Account;
const ENV = { name: "PROD" } as GhEnv;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});
beforeEach(() => {
  vi.clearAllMocks();
  reports.clear();
  apiMocks.getPlanEnv.mockResolvedValue(null);
  apiMocks.triggerWorkflow.mockResolvedValue(undefined);
  apiMocks.fetchStageReport.mockResolvedValue(null);
});

// Each stage is asked for its own task, so the mock answers per (dir, kind) pair.
const reports = new Map<string, { stage: object; createdAt: number }>();
function reportFor(dir: string, kind: "plan" | "deploy", stage: object, createdAt = 2000) {
  reports.set(`${kind}:${dir}`, { stage, createdAt });
  apiMocks.fetchStageReport.mockImplementation(
    async (_a: unknown, _r: unknown, _e: unknown, d: string, k: "plan" | "deploy") => reports.get(`${k}:${d}`) ?? null,
  );
}

async function mount() {
  let latest: Plan | null = null;
  root = createRoot(document.createElement("div"));
  function Harness() {
    latest = useDeploymentPlan({
      account: ACCOUNT,
      repoName: "repo-one",
      pipeline: PIPELINE,
      selectedEnv: ENV,
      branches: [{ name: "PROD" }] as Branch[],
      branchMatchError: null,
      envReady: true,
    });
    return null;
  }
  await act(async () => {
    root!.render(React.createElement(Harness));
  });
  return () => latest!;
}

describe("Run Status Update triggers one stage", () => {
  it("dispatches that stage's own workflow, not the all-stages plan", async () => {
    const plan = await mount();

    await act(async () => {
      await plan().onRun("c25cloudfront");
    });

    expect(apiMocks.triggerWorkflow).toHaveBeenCalledTimes(1);
    const workflowId = apiMocks.triggerWorkflow.mock.calls[0][2];
    expect(workflowId).toBe("plan-c25cloudfront.yml");
    expect(workflowId).not.toBe(PIPELINE.workflowId);
  });

  it("watches for the deploy report without dispatching — the remote terminal starts the run", async () => {
    // The hook finds the run id in its own loaded stages rather than being handed one.
    reportFor("c25cloudfront", "plan", { runId: "999", stage: "c25cloudfront", status: "success" });
    const plan = await mount();

    await act(async () => {
      await plan().deployStage("c25cloudfront");
    });

    expect(apiMocks.triggerWorkflow).not.toHaveBeenCalled();
    expect(plan().runs.c25cloudfront).toMatchObject({ kind: "deploy", retryCount: 0, error: null });
  });
});

describe("a failed plan reaches the card with something to show", () => {
  it("carries planLogId through, so the card can fetch the log instead of just saying failed", async () => {
    // Exactly what the workflow reports when the plan fails: no planJson, but a log.
    reportFor("c01subscription", "plan", {
      runId: "555",
      stage: "c01subscription",
      status: "failed",
      planJsonId: null,
      planLogId: 22,
      planLogUrl: "https://x/22",
    });

    const plan = await mount();
    const found = plan().stages.find((s) => s.stage === "c01subscription")!;
    expect(found.status).toBe("failed");
    expect(found.planLogId).toBe(22);
  });
});

describe("every result comes from that stage's own Deployment", () => {
  it("merges the plan report and the deploy report for the same stage", async () => {
    reportFor("c01subscription", "plan", { runId: "new", stage: "c01subscription", status: "success", planLogId: 7 });
    reportFor("c01subscription", "deploy", { deployStatus: "success", deployRunId: "42" });

    const plan = await mount();
    const found = plan().stages.find((s) => s.stage === "c01subscription")!;

    expect(found.status).toBe("success");
    expect(found.runId).toBe("new");
    expect(found.planLogId).toBe(7);
    expect(found.deployStatus).toBe("success");
    expect(found.deployRunId).toBe("42");
  });

  it("asks each stage for its own plan and deploy task — never one bulk list", async () => {
    await mount();
    const asked = apiMocks.fetchStageReport.mock.calls.map((c) => `${c[4]}:${c[3]}`).sort();
    const expected = PIPELINE.stages.flatMap((st) => [`plan:${st.dir}`, `deploy:${st.dir}`]).sort();
    expect(asked).toEqual(expected);
  });

  it("shows a stage that has never reported as pending, not failed", async () => {
    const plan = await mount();
    expect(plan().stages.every((st) => st.status === "pending")).toBe(true);
  });
});

describe("a run belongs to the card that started it", () => {
  it("leaves the other stages untouched while one is polling", async () => {
    const plan = await mount();

    await act(async () => {
      await plan().onRun("c25cloudfront");
    });

    expect(plan().runs["c25cloudfront"]).toBeDefined();
    expect(plan().runs["c25cloudfront"].kind).toBe("plan");
    // The point of the whole per-stage split: c01 must not be greyed out by c25's run.
    for (const other of PIPELINE.stages.filter((st) => st.dir !== "c25cloudfront")) {
      expect(plan().runs[other.dir]).toBeUndefined();
    }
  });

  it("keeps a trigger failure on that stage alone", async () => {
    apiMocks.triggerWorkflow.mockRejectedValueOnce(new Error("boom"));
    const plan = await mount();

    await act(async () => {
      await plan().onRun("c02globalGroups");
    });

    expect(plan().runs["c02globalGroups"].error).toBe("Failed to trigger workflow");
    expect(plan().runs["c01subscription"]).toBeUndefined();
  });

  it("counts down on its own clock, without dragging the others along", async () => {
    const plan = await mount();
    vi.useFakeTimers();
    try {
      await act(async () => {
        await plan().onRun("c01subscription");
      });
      const start = plan().runs["c01subscription"].countdown;

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      await act(async () => {
        await plan().onRun("c25cloudfront");
      });
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(plan().runs["c01subscription"].countdown).toBe(start - 8);
      expect(plan().runs["c25cloudfront"].countdown).toBe(start - 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not put the whole board into loading while one card polls", async () => {
    const plan = await mount();
    vi.useFakeTimers();
    try {
      await act(async () => {
        await plan().onRun("c01subscription");
      });
      // Long enough for the first poll to fire and re-fetch every stage's report.
      await act(async () => {
        vi.advanceTimersByTime(151_000);
      });
      expect(plan().stagesLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a deploy run as a deploy, not a plan", async () => {
    reportFor("c25cloudfront", "plan", { runId: "999", stage: "c25cloudfront", status: "success" });
    const plan = await mount();

    await act(async () => {
      await plan().deployStage("c25cloudfront");
    });

    expect(plan().runs["c25cloudfront"].kind).toBe("deploy");
  });
});

describe("stage workflow files", () => {
  // Assembled from the directory in pipeline.ts, so there is no table that can drift.
  it("carries its own file on every stage, named after its directory", () => {
    const ids = PIPELINE.stages.map((s) => s.workflowId);
    expect(ids).toEqual([
      "plan-c01subscription.yml",
      "plan-c02globalGroups.yml",
      "plan-c07userAccounts.yml",
      "plan-c20awsentrasso.yml",
      "plan-c21awsentrassoP2.yml",
      "plan-c25cloudfront.yml",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps deploy on one shared file, since it has no stage-specific logic", () => {
    // Points at the remote-login terminal for now. Whatever it is called, it is one file — deploy
    // has no per-stage logic to keep apart, unlike plan.
    expect(PIPELINE.deployWorkflowId).toBe("remoteLogin.yml");
    for (const stage of PIPELINE.stages) {
      expect(stage).not.toHaveProperty("deployWorkflowId");
    }
  });
});
