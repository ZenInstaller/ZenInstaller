import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRepoCard, type UseRepoCard } from "../cards/Repo/useRepoCard";
import type { CardStatus } from "../types";

const { mockHooks } = vi.hoisted(() => ({
	mockHooks: {
		useGithubRepo: vi.fn(),
		useGithubEnvironment: vi.fn(),
	},
}));

vi.mock("../cards/Repo/useGithubRepo", () => ({
	useGithubRepo: mockHooks.useGithubRepo,
}));

vi.mock("../cards/Repo/useGithubEnvironment", () => ({
	useGithubEnvironment: mockHooks.useGithubEnvironment,
}));

vi.mock("../logic/github", () => ({
	getEnvSettingsUrl: vi.fn(() => "https://github.example/settings"),
}));

type HookUser = Parameters<typeof useRepoCard>[0]["user"];

type RepoMockState = {
	status: CardStatus | "warning";
	selectedAccount: { login: string } | null;
	selectedRepo: { id: number; name: string } | null;
	repoFullName: string | null;
	templateStatus: "ready" | "not_clone";
	branchList: Array<{ name: string }>;
};

type EnvMockState = {
	status: CardStatus | "warning";
	selectedEnv: { id: string; name: string } | null;
	branchMatchError: string | null;
	branchMatchWarning: string | null;
};

function buildRepo(overrides: Partial<RepoMockState> = {}): RepoMockState {
	return {
		status: "complete",
		selectedAccount: { login: "org-one" },
		selectedRepo: { id: 1, name: "repo-one" },
		repoFullName: "org-one/repo-one",
		templateStatus: "ready",
		branchList: [],
		...overrides,
	};
}

function buildEnv(overrides: Partial<EnvMockState> = {}): EnvMockState {
	return {
		status: "complete",
		selectedEnv: { id: "env-1", name: "prod" },
		branchMatchError: null,
		branchMatchWarning: null,
		...overrides,
	};
}

function HookHarness(props: { onUpdate: (value: UseRepoCard) => void; user: Parameters<typeof useRepoCard>[0]["user"] }) {
	const value = useRepoCard(props);
	useEffect(() => {
		props.onUpdate(value);
	}, [value, props]);
	return null;
}

describe("useRepoCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHooks.useGithubRepo.mockReturnValue(buildRepo() as never);
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv() as never);
	});

	it("combines repo and environment state into a single card", async () => {
		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("complete");
		expect(latest?.summary).toBe("org-one/repo-one · prod");
		expect(latest?.githubEnvUrl).toBe("https://github.example/settings");
		expect(latest?.done).toBe(true);
		expect(latest?.cardDependencyLabel).toBeNull();

		await act(async () => {
			root.unmount();
		});
	});

	it("returns idle status and selection summary when user/account/repo is missing", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ selectedAccount: null }) as never);
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv({ selectedEnv: null }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={null} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("idle");
		expect(latest?.summary).toBe("Select repository and environment");
		expect(latest?.githubEnvUrl).toBeUndefined();

		await act(async () => {
			root.unmount();
		});
	});

	it("returns error status when repo card is not complete", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ status: "error" }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("error");

		await act(async () => {
			root.unmount();
		});
	});

	it("returns idle status and environment prompt when no environment is selected", async () => {
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv({ selectedEnv: null }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("idle");
		expect(latest?.summary).toBe("Select an environment");
		expect(latest?.githubEnvUrl).toBeUndefined();

		await act(async () => {
			root.unmount();
		});
	});

	it("returns error status and error summary when environment branch match errors", async () => {
		mockHooks.useGithubEnvironment.mockReturnValue(
			buildEnv({ branchMatchError: "PR branch does not match environment" }) as never,
		);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("error");
		expect(latest?.summary).toBe("PR branch does not match environment");

		await act(async () => {
			root.unmount();
		});
	});

	it("uses warning summary when branch warning exists and no error", async () => {
		mockHooks.useGithubEnvironment.mockReturnValue(
			buildEnv({ branchMatchWarning: "Environment branch is behind" }) as never,
		);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.status).toBe("complete");
		expect(latest?.summary).toBe("Environment branch is behind");

		await act(async () => {
			root.unmount();
		});
	});

	it("returns not-clone summary when template status is not ready", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ templateStatus: "not_clone" }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.summary).toBe("Not a clone repository");

		await act(async () => {
			root.unmount();
		});
	});

	it("does not build github environment URL when repo full name is missing", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ repoFullName: null }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.githubEnvUrl).toBeUndefined();

		await act(async () => {
			root.unmount();
		});
	});

	it("sets dependency label and done for repo-ready but env-not-ready", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ status: "complete" }) as never);
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv({ status: "idle", selectedEnv: null }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.cardDependencyLabel).toBe("Choose an environment");
		expect(latest?.done).toBe(false);

		await act(async () => {
			root.unmount();
		});
	});

	it("treats env warning as ready for dependency label and done", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ status: "complete" }) as never);
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv({ status: "warning" }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.cardDependencyLabel).toBeNull();
		expect(latest?.done).toBe(true);

		await act(async () => {
			root.unmount();
		});
	});

	it("sets dependency label when repo is not ready", async () => {
		mockHooks.useGithubRepo.mockReturnValue(buildRepo({ status: "idle" }) as never);
		mockHooks.useGithubEnvironment.mockReturnValue(buildEnv({ status: "complete" }) as never);

		let latest: UseRepoCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness user={{ login: "org-one" } as HookUser} onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.cardDependencyLabel).toBe("Select a repository & environment");
		expect(latest?.done).toBe(false);

		await act(async () => {
			root.unmount();
		});
	});
});