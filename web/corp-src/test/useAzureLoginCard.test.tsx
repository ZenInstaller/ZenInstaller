import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAzureAccount } from "../cards/AzureLogin/useAzureAccount";
import { useAzureLoginCard, type UseAzureLoginCard } from "../cards/AzureLogin/useAzureLoginCard";
import type { AzureAccount } from "../types";

const { mockHooks } = vi.hoisted(() => ({
	mockHooks: {
		useAzureAccount: vi.fn(),
	},
}));

const { urlMocks } = vi.hoisted(() => ({
	urlMocks: {
		has: vi.fn(),
	},
}));

vi.mock("../cards/AzureLogin/useAzureAccount", () => ({
	useAzureAccount: mockHooks.useAzureAccount,
}));

vi.mock("../config/azureConfig", () => ({
	AZURE_CLIENT_ID: "client-id",
}));

vi.mock("../hooks/useUrlStateManager", () => ({
	INITIAL_URL_PARAMS: {
		has: urlMocks.has,
	},
}));

function HookHarness(props: { onUpdate: (value: UseAzureLoginCard) => void; savedTenantId: string }) {
	const value = useAzureLoginCard({ savedTenantId: props.savedTenantId });
	useEffect(() => {
		props.onUpdate(value);
	}, [value, props]);
	return null;
}

describe("useAzureLoginCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		urlMocks.has.mockReturnValue(false);
	});

	function createAzureState(overrides: Partial<UseAzureAccount> = {}): UseAzureAccount {
		return {
			account: {
				username: "org@example.com",
				homeAccountId: "home",
				tenantId: "tenant-home",
				tenantProfiles: new Map([["tenant-1", {}]]),
			} as AzureAccount,
			confirmedTenantId: "tenant-1",
			manualTenantId: "tenant-1",
			selectTenant: vi.fn(),
			tenants: [{ tenantId: "tenant-1", displayName: "Tenant One" }],
			tenantsLoaded: true,
			login: vi.fn(),
			logout: vi.fn(),
			refresh: vi.fn(),
			loggingIn: false,
			loginError: null,
			setManualTenantId: vi.fn(),
			tenantIdError: null,
			...overrides,
		};
	}

	it("applies a saved tenant and exposes the projected login state", async () => {
		const selectTenant = vi.fn();
		const mockedAzureAccount = createAzureState({ selectTenant });
		mockHooks.useAzureAccount.mockReturnValue(mockedAzureAccount);

		let latest: UseAzureLoginCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={(value) => { latest = value; }} />);
		});

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(selectTenant).toHaveBeenCalledWith("tenant-1");
		expect(latest?.cardId).toBe("azure_login");
		expect(latest?.status).toBe("complete");
		expect(latest?.summary).toBe("org@example.com · Tenant One");
		expect(latest?.done).toBe(true);
		expect(latest?.cardDependencyLabel).toBe("Select a tenant");
		expect(latest?.restore.tenant.apply("Tenant One")).toBe(true);

		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-apply when savedTenantId is empty", async () => {
		const selectTenant = vi.fn();
		mockHooks.useAzureAccount.mockReturnValue(createAzureState({ selectTenant }));

		const root = createRoot(document.createElement("div"));
		await act(async () => {
			root.render(<HookHarness savedTenantId="" onUpdate={() => {}} />);
		});

		expect(selectTenant).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-apply again for the same saved tenant on rerender", async () => {
		const selectTenant = vi.fn();
		mockHooks.useAzureAccount.mockReturnValue(createAzureState({ selectTenant }));

		const root = createRoot(document.createElement("div"));
		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={() => {}} />);
		});

		expect(selectTenant).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={() => {}} />);
		});

		expect(selectTenant).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-apply when URL already contains a tenant param", async () => {
		const selectTenant = vi.fn();
		urlMocks.has.mockImplementation((key: string) => key === "tenant");
		mockHooks.useAzureAccount.mockReturnValue(createAzureState({ selectTenant }));

		const root = createRoot(document.createElement("div"));
		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={() => {}} />);
		});

		expect(selectTenant).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-apply when there is no azure account", async () => {
		const selectTenant = vi.fn();
		mockHooks.useAzureAccount.mockReturnValue(createAzureState({ account: null, selectTenant }));

		const root = createRoot(document.createElement("div"));
		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={() => {}} />);
		});

		expect(selectTenant).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("does not auto-apply when account does not include the saved tenant", async () => {
		const selectTenant = vi.fn();
		const accountWithoutSavedTenant = {
			username: "org@example.com",
			homeAccountId: "home",
			tenantId: "tenant-home",
			tenantProfiles: new Map([["tenant-2", {}]]),
		} as AzureAccount;
		mockHooks.useAzureAccount.mockReturnValue(
			createAzureState({ account: accountWithoutSavedTenant, selectTenant }),
		);

		const root = createRoot(document.createElement("div"));
		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={() => {}} />);
		});

		expect(selectTenant).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("returns false when restore tenant value does not match any tenant", async () => {
		const selectTenant = vi.fn();
		const mockedAzureAccount = createAzureState({
			selectTenant,
			tenants: [{ tenantId: "tenant-1", displayName: "Tenant One" }],
		});
		mockHooks.useAzureAccount.mockReturnValue(mockedAzureAccount);

		let latest: UseAzureLoginCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(<HookHarness savedTenantId="tenant-1" onUpdate={(value) => { latest = value; }} />);
		});

		expect(latest?.restore.tenant.apply("does-not-exist")).toBe(false);
		expect(selectTenant).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.unmount();
		});
	});
});
