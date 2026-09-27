import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePR, type UsePR } from "../hooks/usePR";
import type { Account, PullRequest, RepoOption } from "../../types";

const { apiMocks } = vi.hoisted(() => ({
	apiMocks: {
		fetchPullRequests: vi.fn(),
	},
}));

vi.mock("../../api", () => ({
	fetchPullRequests: apiMocks.fetchPullRequests,
}));

type HookProps = Parameters<typeof usePR>[0];

function HookHarness(props: { onUpdate: (value: UsePR) => void } & Parameters<typeof usePR>[0]) {
	const value = usePR(props);
	useEffect(() => {
		props.onUpdate(value);
	}, [value, props]);
	return null;
}

async function waitFor(assertion: () => void, timeoutMs = 1500) {
	const start = Date.now();
	while (true) {
		let passed = false;
		let lastError: unknown;

		await act(async () => {
			try {
				assertion();
				passed = true;
			} catch (error) {
				lastError = error;
			}
		});

		if (passed) return;
		if (Date.now() - start > timeoutMs) throw lastError;

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

describe("usePR", () => {
	const accountOne: Account = { login: "org-one", type: "Organization", id: 101 };
	const accountTwo: Account = { login: "org-two", type: "Organization", id: 102 };
	const repoOne: RepoOption = { id: 1, name: "repo-one" };
	const repoTwo: RepoOption = { id: 2, name: "repo-two" };
	const prs: PullRequest[] = [
		{
			id: 301,
			number: 12,
			title: "Add feature",
			state: "open",
			html_url: "https://example/pr/12",
			base_branch: "main",
			head_sha: "abc",
		},
		{
			id: 302,
			number: 13,
			title: "Fix bug",
			state: "open",
			html_url: "https://example/pr/13",
			base_branch: "main",
			head_sha: "def",
		},
	];

	function buildProps(overrides: Partial<HookProps> = {}): HookProps {
		return {
			account: accountOne,
			repo: repoOne,
			isCloneRepo: true,
			pendingRestore: { current: { account: null, repo: null, pr: null, env: null } },
			addRestoreWarning: vi.fn(),
			checkRestoreDone: vi.fn(),
			...overrides,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		apiMocks.fetchPullRequests.mockResolvedValue(prs);
	});

	it("loads pull requests and restores the requested PR", async () => {
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));
		const pendingRestore = { current: { account: null, repo: null, pr: "12", env: "prod" } } as React.MutableRefObject<any>;
		const checkRestoreDone = vi.fn();

		await act(async () => {
			root.render(
				<HookHarness
					account={accountOne}
					repo={repoOne}
					isCloneRepo={true}
					pendingRestore={pendingRestore}
					addRestoreWarning={vi.fn()}
					checkRestoreDone={checkRestoreDone}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.selectedPR?.number).toBe(12);
		});

		expect(apiMocks.fetchPullRequests).toHaveBeenCalledWith(accountOne, "repo-one");
		expect(latest?.selectedPR?.number).toBe(12);
		expect(pendingRestore.current.pr).toBeNull();
		expect(pendingRestore.current.env).toBeNull();
		expect(checkRestoreDone).toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("clears pull request state when repo id changes", async () => {
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));
		const props = buildProps();

		await act(async () => {
			root.render(<HookHarness {...props} onUpdate={(value) => { latest = value; }} />);
		});

		await waitFor(() => {
			expect(latest?.pullRequests).toHaveLength(2);
		});

		await act(async () => {
			latest?.setSelectedPR(prs[0]);
		});

		await waitFor(() => {
			expect(latest?.selectedPR?.number).toBe(12);
		});

		await act(async () => {
			root.render(
				<HookHarness
					{...props}
					repo={repoTwo}
					isCloneRepo={false}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.pullRequests).toEqual([]);
			expect(latest?.selectedPR).toBeNull();
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("warns when restore PR is missing and clears restore env", async () => {
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));
		const addRestoreWarning = vi.fn();
		const pendingRestore = {
			current: { account: null, repo: null, pr: "999", env: "staging" },
		} as React.MutableRefObject<any>;

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ pendingRestore, addRestoreWarning })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.pullRequests).toHaveLength(2);
			expect(addRestoreWarning).toHaveBeenCalledWith("Pull request #999 not found");
		});

		expect(pendingRestore.current.pr).toBeNull();
		expect(pendingRestore.current.env).toBeNull();
		expect(latest?.selectedPR).toBeNull();

		await act(async () => {
			root.unmount();
		});
	});

	it("sets refresh failed and clears pending restore PR when load fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		apiMocks.fetchPullRequests.mockRejectedValueOnce(new Error("network"));
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));
		const pendingRestore = {
			current: { account: null, repo: null, pr: "12", env: "staging" },
		} as React.MutableRefObject<any>;

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ pendingRestore })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.prRefreshFailed).toBe(true);
			expect(latest?.prLoading).toBe(false);
		});

		expect(pendingRestore.current.pr).toBeNull();
		expect(consoleError).toHaveBeenCalled();

		consoleError.mockRestore();
		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-load pull requests when account/repo are missing or repo is not clone", async () => {
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ account: null, repo: repoOne, isCloneRepo: true })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.pullRequests).toEqual([]);
		});
		expect(apiMocks.fetchPullRequests).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ account: accountOne, repo: repoOne, isCloneRepo: false })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(apiMocks.fetchPullRequests).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("onRefresh returns early when refs are missing and loads with latest refs when present", async () => {
		let latest: UsePR | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ account: null, repo: null, isCloneRepo: false })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			latest?.onRefresh();
		});
		expect(apiMocks.fetchPullRequests).not.toHaveBeenCalled();

		await act(async () => {
			root.render(
				<HookHarness
					{...buildProps({ account: accountTwo, repo: repoTwo, isCloneRepo: false })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			latest?.onRefresh();
		});

		await waitFor(() => {
			expect(apiMocks.fetchPullRequests).toHaveBeenCalledWith(accountTwo, "repo-two");
		});

		await act(async () => {
			root.unmount();
		});
	});
});