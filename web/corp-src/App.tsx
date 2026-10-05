import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";

import { type CardChrome, type CardHook, type CardId } from "./types";
import { groupSx, EXPANDED_W } from "./config/cardLayout";
import { createResultStorage } from "./logic/resultStorage";
import { useGithubLoginCard } from "./cards/GithubLogin/useGithubLoginCard";
import { useRepoCard } from "./cards/Repo/useRepoCard";
import { useGithubVariables } from "./hooks/useGithubVariables";
import { useUrlRestore, useUrlSync } from "./hooks/useUrlStateManager";
import { useAzureLoginCard } from "./cards/AzureLogin/useAzureLoginCard";
import { useAzureSubscriptionCard } from "./cards/AzureSubscription/useAzureSubscriptionCard";
import { useRemoteTerminalInfraCard } from "./cards/RemoteTerminalInfra/useRemoteTerminalInfraCard";
import { useWebDeployCard } from "./cards/WebDeploy/useWebDeployCard";

import Header from "./components/Header";
import RestoreToast from "./components/RestoreToast";
import GithubLoginCard from "./cards/GithubLogin/GithubLoginCard";
import RepoCard from "./cards/Repo/RepoCard";
import AzureLoginCard from "./cards/AzureLogin/AzureLoginCard";
import AzureSubscriptionCard from "./cards/AzureSubscription/AzureSubscriptionCard";
import RemoteTerminalInfraCard from "./cards/RemoteTerminalInfra/RemoteTerminalInfraCard";
import WebDeployCard from "./cards/WebDeploy/WebDeployCard";

import { withAITracking } from "@microsoft/applicationinsights-react-js";
import { reactPlugin } from "./monitor/applicationInsights";

// TODO: Remove fontSize and fontFamily from all Typography components and rely on theme defaults instead.

// ─── App ──────────────────────────────────────────────────────────────────────

const EXPANDED_CARDS_KEY = "zeninstaller_corp_expanded_cards";
const { save: saveExpandedCards, load: loadExpandedCards } = createResultStorage<CardId[]>(EXPANDED_CARDS_KEY);

function AppDashboard() {
  const allCards: Record<string, CardHook> = {};

  function addCard<T extends CardHook>(newCard: T): T {
    allCards[newCard.cardId] = newCard;
    return newCard;
  }
  // ── Hooks ──────────────────────────────────────────────────────────────────
  const githubLogin = addCard(useGithubLoginCard());

  const githubRepoEnv = addCard(
    useRepoCard({
      user: githubLogin.account,
    }),
  );
  const githubVariables = useGithubVariables({
    account: githubRepoEnv.repo.selectedAccount,
    repoName: githubRepoEnv.repo.selectedRepo?.name ?? null,
    envName: githubRepoEnv.env.branchMatchError ? null : (githubRepoEnv.env.selectedEnv?.name ?? null),
  });
  const githubVariableValues = githubVariables.values;

  // The Azure sign-in session, shared by the login / subscription / app-registration / access-pass cards.
  const azureLogin = addCard(
    useAzureLoginCard({
      savedTenantId: githubVariableValues.AZURE_TENANT_ID ?? "",
    }),
  );

  const azureSubscription = addCard(
    useAzureSubscriptionCard({
      azureAccount: azureLogin.account,
      confirmedTenantId: azureLogin.confirmedTenantId,
      manualTenantId: azureLogin.manualTenantId,
      savedSubscriptionId: githubVariableValues.AZURE_SUBSCRIPTION_ID ?? "",
    }),
  );

  const remoteTerminalInfra = addCard(
    useRemoteTerminalInfraCard({
      variableValues: githubVariableValues,
      azureAccount: azureLogin.account,
      subscriptionId: azureSubscription.selectedSubscriptionId,
      tenantId: githubVariableValues.AZURE_TENANT_ID ?? "",
      allowedOrigins: [window.location.origin],
    }),
  );
  const webDeploy = addCard(
    useWebDeployCard({
      variableValues: githubVariableValues,
      azureAccount: azureLogin.account,
      subscriptionId: azureSubscription.selectedSubscriptionId,
      tenantId: githubVariableValues.AZURE_TENANT_ID ?? "",
      githubAccount: githubRepoEnv.repo.selectedAccount,
      repoName: githubRepoEnv.repo.selectedRepo?.name ?? "",
      selectedEnv: githubRepoEnv.env.selectedEnv,
    }),
  );

  // ── URL restore + sync ───────────────────────────────────────────────────────
  const urlRestore = useUrlRestore([
    {
      active: githubLogin.status === "complete",
      fields: {
        account: githubRepoEnv.repo.restore.account,
        repo: githubRepoEnv.repo.restore.repo,
        env: githubRepoEnv.env.restore.env,
      },
    },
    {
      active: !!azureLogin.account,
      disabled: azureLogin.status === "unavailable",
      fields: {
        tenant: azureLogin.restore.tenant,
        subscription: azureSubscription.restore.subscription,
      },
    },
  ]);
  const selectedRepo = githubRepoEnv.repo.selectedRepo;
  useUrlSync(
    {
      account: githubRepoEnv.repo.selectedAccount?.login,
      repo: selectedRepo && !selectedRepo.isNew ? selectedRepo.name : undefined,
      env: githubRepoEnv.env.selectedEnv?.name,
      tenant: azureLogin.confirmedTenantId || undefined,
      subscription: azureSubscription.selectedSubscriptionId || undefined,
    },
    urlRestore.completed && !githubLogin.loggingIn,
  );

  // ── Accordion + completion flags ───────────────────────────────────────────
  // A Set, not a single id, so multiple cards can stay expanded at once. Persisted so
  // reloading or navigating back restores what was open.
  const [expandedIds, setExpandedIds] = useState<Set<CardId>>(() => new Set(loadExpandedCards() ?? []));
  useEffect(() => {
    saveExpandedCards(Array.from(expandedIds));
  }, [expandedIds]);
  const toggle = (id: CardId) =>
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Jumping to a prerequisite adds it to the expanded set rather than replacing it, so the card
  // you came from stays open too.
  const openCard = (id: CardId) => {
    setExpandedIds((cur) => new Set(cur).add(id));
    requestAnimationFrame(() =>
      document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const cardProps = (id: CardId): CardChrome => {
    const misconfigured = allCards[id].status === "unavailable";
    const requirementsForCard = (allCards[id].cardRequirements ?? [])
      .filter((reqCardId) => !allCards[reqCardId]?.done)
      .map((reqCardId) => ({
        label: allCards[reqCardId].cardDependencyLabel,
        target: reqCardId,
      }));
    const requirements = misconfigured ? [] : requirementsForCard;
    const locked = requirements.length > 0;
    return {
      cardId: id,
      // A locked card's hook computed its status assuming prerequisites were already met —
      // override to "idle" so it doesn't show e.g. a stale "warning" for work it can't do yet.
      status: locked ? "idle" : allCards[id].status,
      summary: allCards[id].summary,
      locked,
      requirements,
      unavailable: misconfigured,
      expanded: expandedIds.has(id),
      onToggle: () => toggle(id),
      onRequirementClick: openCard,
    };
  };
  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Box
        sx={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <Header />

        <Box sx={{ maxWidth: EXPANDED_W, mx: "auto", px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 5 } }}>
          {/* Intro */}
          <Box
            sx={{
              background: "#ffffff",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              px: { xs: 2, sm: 3 },
              py: 2.5,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <Typography sx={{ color: "#475569", lineHeight: 1.7 }}>
              ZenInstaller is used to create your organisation configuration on a number of cloud hosting providers of
              your choosing. Before starting, you will need the following: <br />
              1. A personal email address, using Google, or any other email hosting provider. <br />
              2. An organisation name and domain name. We recommend that you register the domain name with Godaddy
              https://www.godaddy.com/ because we will have automations in place with them. <br />
              Complete the cards below in any order — each shows what it needs before it can run.
            </Typography>
          </Box>

          <Box sx={groupSx}>
            <GithubLoginCard card={cardProps("github_login")} auth={githubLogin} />

            <RepoCard card={cardProps("repo")} githubRepo={githubRepoEnv} lockedByPR={false} />

            <AzureLoginCard card={cardProps("azure_login")} azureLogin={azureLogin} />

            <AzureSubscriptionCard
              card={cardProps("azure_subscription")}
              azure={azureLogin}
              subscription={azureSubscription}
              githubAccount={githubRepoEnv.repo.selectedAccount}
              repoName={githubRepoEnv.repo.selectedRepo?.name ?? ""}
              selectedEnv={githubRepoEnv.env.selectedEnv}
              variables={githubVariables}
              githubUrl={githubRepoEnv.githubEnvUrl}
              onOpenAzureLogin={() => openCard("azure_login")}
              onUserInteract={() => urlRestore.cancel(["tenant", "subscription"])}
            />

            <RemoteTerminalInfraCard
              card={cardProps("remote_terminal_infra")}
              infra={remoteTerminalInfra}
              subscriptionId={azureSubscription.selectedSubscriptionId}
              tenantId={githubVariableValues.AZURE_TENANT_ID}
              githubAccount={githubRepoEnv.repo.selectedAccount}
              repoName={githubRepoEnv.repo.selectedRepo?.name ?? ""}
              selectedEnv={githubRepoEnv.env.selectedEnv}
              variables={githubVariables}
              githubUrl={githubRepoEnv.githubEnvUrl}
            />

            <WebDeployCard
              card={cardProps("web_deploy")}
              web={webDeploy}
              githubAccount={githubRepoEnv.repo.selectedAccount}
              repoName={githubRepoEnv.repo.selectedRepo?.name ?? ""}
              selectedEnv={githubRepoEnv.env.selectedEnv}
              variables={githubVariables}
              githubUrl={githubRepoEnv.githubEnvUrl}
              repoFullName={
                githubRepoEnv.repo.selectedAccount && githubRepoEnv.repo.selectedRepo
                  ? `${githubRepoEnv.repo.selectedAccount.login}/${githubRepoEnv.repo.selectedRepo.name}`
                  : null
              }
            />
          </Box>
        </Box>
      </Box>

      <RestoreToast
        loading={urlRestore.restoring}
        warnings={urlRestore.warnings}
        onDismiss={urlRestore.dismissWarnings}
      />
    </>
  );
}

export default withAITracking(reactPlugin, AppDashboard, "corpInstaller");
