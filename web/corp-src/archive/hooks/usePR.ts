import { useCallback, useEffect, useRef, useState } from "react";
import { fetchPullRequests } from "../../api";
import type { Account, PullRequest, RepoOption } from "../../types";
import type { PendingRestore } from "./useUrlRestore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsePR {
  pullRequests: PullRequest[];
  selectedPR: PullRequest | null;
  setSelectedPR: (pr: PullRequest | null) => void;
  prLoading: boolean;
  prRefreshFailed: boolean;
  onRefresh: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type UsePRParams = {
  account: Account | null;
  repo: RepoOption | null;
  isCloneRepo: boolean;
  pendingRestore: React.MutableRefObject<PendingRestore>;
  addRestoreWarning: (msg: string) => void;
  checkRestoreDone: () => void;
};

export function usePR(opts: UsePRParams): UsePR {
  const { pendingRestore, addRestoreWarning, checkRestoreDone } = opts;

  // ── Latest-value refs ──────────────────────────────────────────────────────
  const accountRef = useRef(opts.account);
  accountRef.current = opts.account;
  const repoRef = useRef(opts.repo);
  repoRef.current = opts.repo;

  // ── State ─────────────────────────────────────────────────────────────────
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [selectedPR, setSelectedPR] = useState<PullRequest | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prRefreshFailed, setPrRefreshFailed] = useState(false);

  // Auto-clear when repo changes
  const prevRepoId = useRef<number | string | null | undefined>(undefined);
  useEffect(() => {
    const newId = opts.repo?.id ?? null;
    if (prevRepoId.current !== undefined && prevRepoId.current !== newId) {
      setPullRequests([]);
      setSelectedPR(null);
    }
    prevRepoId.current = newId;
  }, [opts.repo?.id]);

  // ── Loader ────────────────────────────────────────────────────────────────
  const loadPRs = useCallback(
    async (account: Account, repo: RepoOption) => {
      setPrLoading(true);
      setPrRefreshFailed(false);
      try {
        const prs = await fetchPullRequests(account, repo.name);
        setPullRequests(prs);
        const targetPr = pendingRestore.current.pr;
        pendingRestore.current.pr = null;
        if (targetPr) {
          const match = prs.find((p) => p.number === Number(targetPr));
          if (match) {
            pendingRestore.current.env = null; // PR auto-selects env
            setSelectedPR(match);
          } else {
            addRestoreWarning(`Pull request #${targetPr} not found`);
            pendingRestore.current.env = null;
          }
        }
      } catch (e) {
        console.error(e);
        setPrRefreshFailed(true);
        pendingRestore.current.pr = null;
      } finally {
        setPrLoading(false);
        checkRestoreDone();
      }
    },
    [addRestoreWarning, checkRestoreDone, pendingRestore],
  );

  // Load when repo becomes a clone (template confirmed)
  useEffect(() => {
    if (!opts.account || !opts.repo || !opts.isCloneRepo) return;
    loadPRs(opts.account, opts.repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.account?.id, opts.repo?.id, opts.isCloneRepo, loadPRs]);

  const onRefresh = useCallback(() => {
    const acc = accountRef.current;
    const repo = repoRef.current;
    if (!acc || !repo) return;
    loadPRs(acc, repo);
  }, [loadPRs]);

  return { pullRequests, selectedPR, setSelectedPR, prLoading, prRefreshFailed, onRefresh };
}
