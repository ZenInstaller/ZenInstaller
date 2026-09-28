import { useCallback, useEffect, useRef, useState } from "react";
import { checkTemplate, createBranch, fetchBranches, fetchOrgList, fetchRepos, generateRepo } from "../../api";
import { PIPELINE } from "../../logic/pipeline";
import { findIgnoreCase } from "../../logic/search";
import { INITIAL_URL_PARAMS, type UrlRestoreField } from "../../hooks/useUrlStateManager";
import type { Account, Branch, CardStatus, Repo, RepoOption, User } from "../../types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseGithubRepo {
  // Account
  accountList: Account[];
  selectedAccount: Account | null;
  setSelectedAccount: (a: Account | null) => void;
  // Repository
  repoList: Repo[];
  selectedRepo: RepoOption | null;
  setSelectedRepo: (r: RepoOption | null) => void;
  // Template
  templateStatus: "checking" | "ready" | "not_clone";
  templateName: string | null;
  repoFullName: string | null;
  // Clone
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  includeAllBranch: boolean;
  setIncludeAllBranch: (v: boolean) => void;
  cloning: boolean;
  cloneError: string | null;
  createEnvs: boolean;
  setCreateEnvs: (v: boolean) => void;
  cloneEnvWarning: string | null;
  // Branch
  branchList: Branch[];
  sourceBranch: string;
  setSourceBranch: (v: string) => void;
  creatingBranch: boolean;
  createBranchError: string | null;
  // Status
  status: CardStatus;
  repoLoading: boolean;
  repoRefreshFailed: boolean;
  // Actions
  onClone: () => Promise<void>;
  onRefresh: () => void;
  onCreateBranch: (targetName: string) => Promise<void>;
  // Restore
  restore: {
    account: UrlRestoreField;
    repo: UrlRestoreField;
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/*
 * The GitHub account/repo/clone/branch layer — not a card. Shared by the repo card
 * (which just needs status) and useGithubEnvironment (which needs the account,
 * selected repo, and branches to load environments and match a branch).
 */
export function useGithubRepo(user: User | null): UseGithubRepo {
  const { validEnvs, templateRepo } = PIPELINE;

  // ── State ─────────────────────────────────────────────────────────────────
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [repoList, setRepoList] = useState<Repo[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<RepoOption | null>(null);

  const [templateStatus, setTemplateStatus] = useState<"checking" | "ready" | "not_clone">("not_clone");
  const [templateName, setTemplateName] = useState<string | null>(null);

  const [isPrivate, setIsPrivate] = useState(true);
  const [includeAllBranch, setIncludeAllBranch] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [createEnvs, setCreateEnvs] = useState(true);
  const [cloneEnvWarning, setCloneEnvWarning] = useState<string | null>(null);

  const [branchList, setBranchList] = useState<Branch[]>([]);
  const [sourceBranch, setSourceBranch] = useState<string>("main");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [createBranchError, setCreateBranchError] = useState<string | null>(null);

  const [status, setStatus] = useState<CardStatus>("idle");
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoRefreshFailed, setRepoRefreshFailed] = useState(false);

  // Pure cache to avoid refetching a repo list already seen this session — never rendered directly.
  const repoCache = useRef<Record<string, Repo[]>>({});

  // ── Derived ───────────────────────────────────────────────────────────────
  const isNewRepo = selectedRepo?.isNew ?? false;
  const repoFullName =
    selectedAccount && selectedRepo && !isNewRepo ? `${selectedAccount.login}/${selectedRepo.name}` : null;

  // Auto-clear clone error when a different repo is selected
  useEffect(() => {
    setCloneError(null);
  }, [selectedRepo?.id]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const loadBranches = useCallback(async (account: Account, repo: RepoOption) => {
    try {
      const list = await fetchBranches(account, repo.name);
      setBranchList(list);
      const main = list.find((b) => b.name === "main");
      setSourceBranch(main ? "main" : (list[0]?.name ?? "main"));
    } catch (e) {
      console.error("Failed to fetch branches:", e);
    }
  }, []);

  const checkSelectedRepo = useCallback(
    async (account: Account | null, repo: RepoOption | null) => {
      setTemplateStatus("checking");
      setTemplateName(null);
      setBranchList([]);
      setStatus("loading");
      if (!account || !repo || repo.isNew) return;
      try {
        const data = await checkTemplate(account, repo.name);
        const tName = data.templateName || null;
        setTemplateName(tName);
        const isTemplate = tName !== null && tName === templateRepo;
        if (!isTemplate) {
          setTemplateStatus("not_clone");
          setStatus("warning");
          return;
        }

        setTemplateStatus("ready");
        setStatus("complete");
        await loadBranches(account, repo);
      } catch (e) {
        console.error("Failed to check template:", e);
        setTemplateStatus("not_clone");
        setStatus("warning");
      }
    },
    [templateRepo, loadBranches],
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  // Load organizations once user authenticates
  useEffect(() => {
    if (!user) return;
    fetchOrgList()
      .then((data) => {
        setAccountList(data);
        // Don't clobber a pending URL restore with the default selection.
        if (!INITIAL_URL_PARAMS.has("account")) setSelectedAccount(data[0] ?? null);
      })
      .catch(console.error)
      .finally(() => setAccountsLoaded(true));
  }, [user]);

  // Load repositories when account changes
  useEffect(() => {
    setRepoList([]);
    setSelectedRepo(null);
    setStatus("idle");
    setReposLoaded(false);
    if (!selectedAccount) return;
    const key = String(selectedAccount.id);
    if (repoCache.current[key]) {
      setRepoList(repoCache.current[key]);
      setReposLoaded(true);
      return;
    }
    let cancelled = false;
    fetchRepos(selectedAccount)
      .then((list) => {
        repoCache.current[key] = list;
        if (!cancelled) setRepoList(list);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setReposLoaded(true);
      });
    setTemplateName(null);
    return () => {
      cancelled = true;
    };
  }, [selectedAccount]);

  // Check selected repository
  useEffect(() => {
    checkSelectedRepo(selectedAccount, selectedRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo?.id, selectedAccount?.id, checkSelectedRepo]);

  // ── Stable refs (for callbacks below that shouldn't re-create on every state change) ──
  const repoListRef = useRef(repoList);
  repoListRef.current = repoList;
  const selectedAccountRef = useRef(selectedAccount);
  selectedAccountRef.current = selectedAccount;
  const selectedRepoRef = useRef(selectedRepo);
  selectedRepoRef.current = selectedRepo;
  const sourceBranchRef = useRef(sourceBranch);
  sourceBranchRef.current = sourceBranch;

  // ── Actions ───────────────────────────────────────────────────────────────
  const onClone = useCallback(async () => {
    const acc = selectedAccountRef.current;
    const repo = selectedRepoRef.current;
    if (!acc || !repo) return;
    const name = repo.name;
    if (repoListRef.current.find((r) => r.name === name)) {
      setCloneError(`Repository "${name}" already exists`);
      return;
    }
    setCloning(true);
    setCloneError(null);
    setCloneEnvWarning(null);
    try {
      const {
        repo: newRepo,
        envSuccess,
        results,
      } = await generateRepo(acc, name, isPrivate, includeAllBranch, createEnvs, templateRepo, validEnvs);
      const updated = [...repoListRef.current, newRepo];
      setRepoList(updated);
      repoCache.current[String(acc.id)] = updated;
      setSelectedRepo({ id: newRepo.id, name: newRepo.name });
      if (!envSuccess) {
        const failed = results.envs.filter((e) => !e.success).map((e) => e.name);
        setCloneEnvWarning(`Repo created but failed to create environments: ${failed.join(", ")}`);
      }
    } catch {
      setCloneError("Clone failed");
    } finally {
      setCloning(false);
    }
  }, [isPrivate, includeAllBranch, createEnvs, templateRepo, validEnvs]);

  const onRefresh = useCallback(() => {
    const acc = selectedAccountRef.current;
    if (!acc) return;
    const key = String(acc.id);
    setRepoLoading(true);
    setRepoRefreshFailed(false);
    delete repoCache.current[key];
    Promise.all([fetchOrgList(), fetchRepos(acc)])
      .then(([orgs, list]) => {
        setAccountList(orgs);
        setRepoList(list);
        repoCache.current[key] = list;
      })
      .catch((e) => {
        console.error(e);
        setRepoRefreshFailed(true);
      })
      .finally(() => setRepoLoading(false));
  }, []);

  const onCreateBranch = useCallback(async (targetName: string) => {
    const acc = selectedAccountRef.current;
    const repo = selectedRepoRef.current;
    if (!acc || !repo) return;
    setCreatingBranch(true);
    setCreateBranchError(null);
    try {
      const newBranch = await createBranch(acc, repo.name, targetName, sourceBranchRef.current);
      setBranchList((prev) => [...prev, newBranch]);
    } catch {
      setCreateBranchError("Failed to create branch");
    } finally {
      setCreatingBranch(false);
    }
  }, []);

  // ── Restore ───────────────────────────────────────────────────────────────
  const restoreAccount = useCallback(
    (value: string): boolean => {
      const match = findIgnoreCase(accountList, (a) => a.login, value);
      // Fall back to the default selection on a miss — leaving nothing selected strands the UI.
      setSelectedAccount(match ?? accountList[0] ?? null);
      return !!match;
    },
    [accountList],
  );

  const restoreRepo = useCallback(
    (value: string): boolean => {
      const match = findIgnoreCase(repoList, (r) => r.name, value);
      if (!match) return false;
      setSelectedRepo({ id: match.id, name: match.name });
      return true;
    },
    [repoList],
  );

  return {
    // Account
    accountList,
    selectedAccount,
    setSelectedAccount,
    // Repository
    repoList,
    selectedRepo,
    setSelectedRepo,
    // Template
    templateStatus,
    templateName,
    repoFullName,
    // Clone
    isPrivate,
    setIsPrivate,
    includeAllBranch,
    setIncludeAllBranch,
    cloning,
    cloneError,
    createEnvs,
    setCreateEnvs,
    cloneEnvWarning,
    // Branch
    branchList,
    sourceBranch,
    setSourceBranch,
    creatingBranch,
    createBranchError,
    // Status
    status,
    repoLoading,
    repoRefreshFailed,
    // Actions
    onClone,
    onRefresh,
    onCreateBranch,
    // Restore
    restore: {
      account: { ready: accountsLoaded, scope: user?.login ?? null, apply: restoreAccount },
      repo: { ready: reposLoaded, scope: selectedAccount?.id ?? null, apply: restoreRepo },
    },
  };
}
