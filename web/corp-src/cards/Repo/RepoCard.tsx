import { Box } from "@mui/material";
import Card from "../../components/Card";
import ViewLink from "../../components/ViewLink";
import RepoDetail, { Intro as RepoDetailIntro } from "./RepoDetail";
import EnvDetail from "./EnvDetail";
import { getRepoUrl } from "../../logic/github";
import { TEMPLATE_REPO, VALID_ENVS } from "../../config/githubConfig";
import type { CardChrome } from "../../types";
import type { UseRepoCard } from "./useRepoCard";

type Props = {
  card: CardChrome;
  githubRepo: UseRepoCard;
  lockedByPR: boolean;
};

function Intro() {
  return <RepoDetailIntro />;
}

/*
 * The repo card actually spans two concerns — which repo, and which environment in
 * it — so unlike the other cards its content is two Detail components, not one.
 */
function Action({ repoFullName }: { repoFullName: string | null }) {
  if (!repoFullName) return null;
  return <ViewLink href={getRepoUrl(repoFullName)} />;
}

export default function RepoCard({ card, githubRepo, lockedByPR }: Props) {
  const { repo, env } = githubRepo;
  return (
    <Card
      title="Repository & environment"
      action={<Action repoFullName={repo.repoFullName} />}
      lockedIntro={<Intro />}
      {...card}
    >
      <RepoDetail
        accounts={repo.accountList}
        selectedAccount={repo.selectedAccount}
        onAccountChange={repo.setSelectedAccount}
        repos={repo.repoList}
        selectedRepo={repo.selectedRepo}
        onRepoChange={repo.setSelectedRepo}
        templateStatus={repo.templateStatus}
        templateName={repo.templateName}
        defaultTemplateRepo={TEMPLATE_REPO}
        isPrivate={repo.isPrivate}
        onIsPrivateChange={repo.setIsPrivate}
        includeAllBranch={repo.includeAllBranch}
        onIncludeAllBranchChange={repo.setIncludeAllBranch}
        cloning={repo.cloning}
        cloneError={repo.cloneError}
        onClone={repo.onClone}
        createEnvs={repo.createEnvs}
        onCreateEnvsChange={repo.setCreateEnvs}
        cloneEnvWarning={repo.cloneEnvWarning}
        repoLoading={repo.repoLoading}
        repoRefreshFailed={repo.repoRefreshFailed}
        onRefresh={repo.onRefresh}
      />
      {!repo.selectedRepo?.isNew && (
        <Box sx={{ mt: 2.5, pt: 2.5, borderTop: "1px solid #f1f5f9" }}>
          <EnvDetail
            envList={env.envList}
            validEnvs={VALID_ENVS}
            selectedEnv={env.selectedEnv}
            onEnvChange={env.setSelectedEnv}
            lockedByPR={lockedByPR}
            branchMatchWarning={env.branchMatchWarning}
            branchMatchError={env.branchMatchError}
            loading={env.envLoading}
            refreshFailed={env.envRefreshFailed}
            onRefresh={env.onRefresh}
            repoFullName={repo.repoFullName}
            branches={repo.branchList}
            sourceBranch={repo.sourceBranch}
            onSourceBranchChange={repo.setSourceBranch}
            creatingBranch={repo.creatingBranch}
            createBranchError={repo.createBranchError}
            onCreateBranch={repo.onCreateBranch}
          />
        </Box>
      )}
    </Card>
  );
}
