import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAzureSubscriptionCard, type UseAzureSubscriptionCard } from "../cards/AzureSubscription/useAzureSubscriptionCard";
import type { AzureAccount } from "../types";

async function waitFor(assertion: () => void, timeoutMs = 1000) {
	const start = Date.now();
	for (;;) {
		try {
			assertion();
			return;
		} catch (error) {
			if (Date.now() - start >= timeoutMs) {
				throw error;
			}
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		}
	}
}

const { apiMocks } = vi.hoisted(() => ({
	apiMocks: {
		listSubscriptions: vi.fn(),
	},
}));

vi.mock("../api/azureGraph", () => ({
	listSubscriptions: apiMocks.listSubscriptions,
}));

vi.mock("../config/azureConfig", () => ({
	AZURE_CLIENT_ID: "client-id",
}));

function HookHarness(props: { onUpdate: (value: UseAzureSubscriptionCard) => void } & Parameters<typeof useAzureSubscriptionCard>[0]) {
	const value = useAzureSubscriptionCard(props);
	useEffect(() => {
		props.onUpdate(value);
	}, [value, props]);
	return null;
}

describe("useAzureSubscriptionCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiMocks.listSubscriptions.mockResolvedValue([{ id: "sub-1", displayName: "Main" }]);
	});

	it("loads subscriptions and marks a saved subscription complete", async () => {
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));
		const account = { username: "org@example.com", tenantId: "tenant-1" } as AzureAccount;

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={account}
					confirmedTenantId="tenant-1"
					manualTenantId="tenant-1"
					savedSubscriptionId="sub-1"
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(apiMocks.listSubscriptions).toHaveBeenCalledWith(account, "tenant-1");
		expect(latest?.selectedSubscriptionId).toBe("sub-1");
		expect(latest?.subscriptionLabel).toBe("Main");
		expect(latest?.status).toBe("complete");
		expect(latest?.summary).toBe("Main");
		expect(latest?.done).toBe(true);

		await act(async () => {
			expect(latest?.restore.subscription.apply("Main")).toBe(true);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("does not load subscriptions without an azure account", async () => {
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={null}
					confirmedTenantId="tenant-1"
					manualTenantId="tenant-1"
					savedSubscriptionId=""
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(apiMocks.listSubscriptions).not.toHaveBeenCalled();
		expect(latest?.subscriptions).toEqual([]);
		expect(latest?.subsError).toBeNull();
		expect(latest?.restore.subscription.ready).toBe(false);

		await act(async () => {
			root.unmount();
		});
	});

	it("does not load subscriptions when confirmed tenant is blank", async () => {
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));
		const account = { username: "org@example.com", tenantId: "tenant-1" } as AzureAccount;

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={account}
					confirmedTenantId="   "
					manualTenantId="tenant-1"
					savedSubscriptionId=""
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(apiMocks.listSubscriptions).not.toHaveBeenCalled();
		expect(latest?.subscriptions).toEqual([]);
		expect(latest?.subsError).toBeNull();
		expect(latest?.restore.subscription.ready).toBe(false);

		await act(async () => {
			root.unmount();
		});
	});

	it("shows no-subscriptions error when tenant has no subscriptions", async () => {
		apiMocks.listSubscriptions.mockResolvedValueOnce([]);
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));
		const account = { username: "org@example.com", tenantId: "tenant-1" } as AzureAccount;

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={account}
					confirmedTenantId="tenant-1"
					manualTenantId="tenant-1"
					savedSubscriptionId=""
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.restore.subscription.ready).toBe(true);
			expect(latest?.subsError).toBe("No subscriptions found for this account.");
			expect(latest?.subscriptions).toEqual([]);
			expect(latest?.subscriptionNoAccess).toBe(true);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("maps AADSTS90072 errors to membership guidance", async () => {
		apiMocks.listSubscriptions.mockRejectedValueOnce(new Error("AADSTS90072: User is not a member"));
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));
		const account = { username: "org@example.com", tenantId: "tenant-1" } as AzureAccount;

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={account}
					confirmedTenantId="tenant-1"
					manualTenantId="tenant-1"
					savedSubscriptionId=""
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.restore.subscription.ready).toBe(true);
			expect(latest?.subsError).toBe(
				"This account isn't a member of that tenant — sign in with a different account, or have an admin add it as a guest first.",
			);
			expect(latest?.subscriptionNoAccess).toBe(true);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("maps unknown subscription loading errors to the generic message", async () => {
		apiMocks.listSubscriptions.mockRejectedValueOnce(new Error("Network timeout"));
		let latest: UseAzureSubscriptionCard | null = null;
		const root = createRoot(document.createElement("div"));
		const account = { username: "org@example.com", tenantId: "tenant-1" } as AzureAccount;

		await act(async () => {
			root.render(
				<HookHarness
					azureAccount={account}
					confirmedTenantId="tenant-1"
					manualTenantId="tenant-1"
					savedSubscriptionId=""
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.restore.subscription.ready).toBe(true);
			expect(latest?.subsError).toBe("Couldn't load subscriptions for this tenant — check the tenant ID or your access, then try again.");
			expect(latest?.subscriptionNoAccess).toBe(true);
		});

		await act(async () => {
			root.unmount();
		});
	});
});
