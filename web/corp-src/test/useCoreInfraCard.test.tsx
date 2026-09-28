import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoreInfraCard, type UseCoreInfraCard } from "../cards/CoreInfra/useCoreInfraCard";
import type { AzureAccount } from "../types";

async function waitFor(assertion: () => void, timeoutMs = 2000) {
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
		getProviderRegistrationState: vi.fn(),
		registerProvider: vi.fn(),
		ensureResourceGroup: vi.fn(),
		resourceGroupExists: vi.fn(),
		ensureLogAnalyticsWorkspace: vi.fn(),
		ensureSubscriptionDiagnostics: vi.fn(),
		ensureAppInsights: vi.fn(),
		ensureStorageAccount: vi.fn(),
		ensureStorageContainer: vi.fn(),
		ensureRbacRoleAtScope: vi.fn(),
		hasRbacRoleAtScope: vi.fn(),
		listLocations: vi.fn(),
		getExistingSP: vi.fn(),
		ensureScopeConsent: vi.fn(),
		resourceGroupScope: vi.fn((subscriptionId: string, resourceGroupName: string) => `${subscriptionId}/${resourceGroupName}`),
		storageAccountScope: vi.fn(
			(subscriptionId: string, resourceGroupName: string, storageAccountName: string) =>
				`${subscriptionId}/${resourceGroupName}/${storageAccountName}`,
		),
	},
}));

const { configMocks } = vi.hoisted(() => ({
	configMocks: {
		azureClientId: "client-id",
	},
}));

vi.mock("../api/azureArm", () => ({
	getProviderRegistrationState: apiMocks.getProviderRegistrationState,
	registerProvider: apiMocks.registerProvider,
	ensureResourceGroup: apiMocks.ensureResourceGroup,
	resourceGroupExists: apiMocks.resourceGroupExists,
	ensureLogAnalyticsWorkspace: apiMocks.ensureLogAnalyticsWorkspace,
	ensureSubscriptionDiagnostics: apiMocks.ensureSubscriptionDiagnostics,
	ensureAppInsights: apiMocks.ensureAppInsights,
	ensureStorageAccount: apiMocks.ensureStorageAccount,
	ensureStorageContainer: apiMocks.ensureStorageContainer,
	ensureRbacRoleAtScope: apiMocks.ensureRbacRoleAtScope,
	hasRbacRoleAtScope: apiMocks.hasRbacRoleAtScope,
	listLocations: apiMocks.listLocations,
	resourceGroupScope: apiMocks.resourceGroupScope,
	storageAccountScope: apiMocks.storageAccountScope,
}));

vi.mock("../api/azureGraph", () => ({
	getExistingSP: apiMocks.getExistingSP,
}));

vi.mock("../config/azureConfig", () => ({
	get AZURE_CLIENT_ID() {
		return configMocks.azureClientId;
	},
	CORE_INFRA_PROVIDERS: ["Microsoft.OperationalInsights", "Microsoft.Insights", "Microsoft.Storage"],
	ARM_SCOPES: ["arm.scope"],
	APP_SCOPES: ["app.scope"],
}));

vi.mock("../auth/msal", () => ({
	ensureScopeConsent: apiMocks.ensureScopeConsent,
}));

function HookHarness(
	props: {
		onUpdate: (value: UseCoreInfraCard) => void;
	} & Parameters<typeof useCoreInfraCard>[0],
) {
	const value = useCoreInfraCard(props);
	useEffect(() => {
		props.onUpdate(value);
	}, [value, props]);
	return null;
}

function baseProps(
	overrides: Partial<Parameters<typeof useCoreInfraCard>[0]> = {},
): Parameters<typeof useCoreInfraCard>[0] {
	return {
		azureAccount: { tenantId: "tenant-1" } as AzureAccount,
		subscriptionId: "sub-1",
		corpName: "Zenblox",
		spClientId: "client-a",
		tenantId: "tenant-1",
		...overrides,
	};
}

describe("useCoreInfraCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		sessionStorage.clear();
		configMocks.azureClientId = "client-id";

		apiMocks.resourceGroupExists.mockResolvedValue(true);
		apiMocks.ensureScopeConsent.mockResolvedValue(false);
		apiMocks.getExistingSP.mockResolvedValue({ id: "sp-1" });
		apiMocks.hasRbacRoleAtScope.mockResolvedValue(true);
		apiMocks.listLocations.mockResolvedValue([{ name: "eastus", displayName: "East US" }]);

		apiMocks.getProviderRegistrationState.mockResolvedValue("Registered");
		apiMocks.ensureResourceGroup.mockResolvedValue("created");
		apiMocks.ensureRbacRoleAtScope.mockResolvedValue("created");
		apiMocks.ensureLogAnalyticsWorkspace.mockResolvedValue({ result: "created", id: "/law-id" });
		apiMocks.ensureSubscriptionDiagnostics.mockResolvedValue("created");
		apiMocks.ensureAppInsights.mockResolvedValue("created");
		apiMocks.ensureStorageAccount.mockResolvedValue("created");
		apiMocks.ensureStorageContainer.mockResolvedValue("created");
	});

	it("computes resultMatches and resets steps when persisted result no longer matches props", async () => {
		localStorage.setItem(
			"zeninstaller_infra_result",
			JSON.stringify({ corpName: "Zenblox", subscriptionId: "sub-1" }),
		);

		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(latest?.resultMatches).toBe(true);

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect((latest?.steps.length ?? 0) > 0).toBe(true);
		});

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ corpName: "ZenbloxTwo" })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.resultMatches).toBe(false);
			expect(latest?.steps).toEqual([]);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("keeps infra status unknown when RBAC prerequisites are missing", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ azureAccount: null })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(latest?.infraRbacStatus).toBe("unknown");
		expect(apiMocks.resourceGroupExists).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("marks infra status rg-not-found when resource group does not exist", async () => {
		apiMocks.resourceGroupExists.mockResolvedValueOnce(false);
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.infraRbacStatus).toBe("rg-not-found");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("marks infra status missing-role when service principal is missing", async () => {
		apiMocks.getExistingSP.mockResolvedValueOnce(null);
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.infraRbacStatus).toBe("missing-role");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("marks infra status missing-role when contributor role is absent", async () => {
		apiMocks.hasRbacRoleAtScope.mockResolvedValueOnce(false);
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.infraRbacStatus).toBe("missing-role");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("marks infra status ready when resource group exists and contributor role is present", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.infraRbacStatus).toBe("ready");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("falls back to unknown infra status when RBAC probe throws", async () => {
		apiMocks.resourceGroupExists.mockRejectedValueOnce(new Error("token error"));
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.infraRbacStatus).toBe("unknown");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("clears locations when account/subscription are missing", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ azureAccount: null })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		expect(latest?.locations).toEqual([]);
		expect(apiMocks.listLocations).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("loads subscription locations successfully", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.locationsLoading).toBe(false);
			expect(latest?.locations).toEqual([{ name: "eastus", displayName: "East US" }]);
			expect(latest?.locationsError).toBeNull();
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("sets locationsError when regions cannot be loaded", async () => {
		apiMocks.listLocations.mockRejectedValueOnce(new Error("region fetch failed"));
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.locationsLoading).toBe(false);
			expect(latest?.locationsError).toBe("region fetch failed");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("returns early from run when required inputs are missing", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ azureAccount: null, subscriptionId: "", corpName: "", spClientId: "" })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		expect(latest?.running).toBe(false);
		expect(latest?.steps).toEqual([]);
		expect(apiMocks.ensureResourceGroup).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
	});

	it("runs full provisioning flow and records skipped details when resources exist", async () => {
		apiMocks.ensureResourceGroup.mockResolvedValueOnce("exists");
		apiMocks.ensureRbacRoleAtScope.mockResolvedValueOnce("exists").mockResolvedValueOnce("exists");
		apiMocks.ensureLogAnalyticsWorkspace.mockResolvedValueOnce({ result: "exists", id: "/law-id" });
		apiMocks.ensureSubscriptionDiagnostics.mockResolvedValueOnce("exists");
		apiMocks.ensureAppInsights.mockResolvedValueOnce("exists");
		apiMocks.ensureStorageAccount.mockResolvedValueOnce("exists");
		apiMocks.ensureStorageContainer.mockResolvedValueOnce("exists");

		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect(latest?.running).toBe(false);
			expect(latest?.steps.find((s) => s.id === "rg")?.status).toBe("skipped");
			expect(latest?.steps.find((s) => s.id === "rg")?.detail).toBe("Already exists");
			expect(latest?.steps.find((s) => s.id === "rbac")?.status).toBe("skipped");
			expect(latest?.steps.find((s) => s.id === "rbac")?.detail).toBe("Already assigned");
			expect(localStorage.getItem("zeninstaller_infra_result")).not.toBeNull();
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("asks for every scope up front, one call per resource, before doing any work", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect(apiMocks.ensureScopeConsent).toHaveBeenCalledTimes(1);
		});
		// ARM consent is already established by the Azure login card, so only Graph is asked for here.
		expect(apiMocks.ensureScopeConsent.mock.calls[0][1]).toEqual(["app.scope"]);
		// Nothing may run before consent is settled — a redirect here must cost no progress.
		expect(apiMocks.ensureScopeConsent.mock.invocationCallOrder[0]).toBeLessThan(
			apiMocks.ensureResourceGroup.mock.invocationCallOrder[0],
		);
		expect(latest?.steps.find((s) => s.id === "consent")?.status).toBe("skipped");

		await act(async () => {
			root.unmount();
		});
	});

	it("marks rg-rbac as error when service principal cannot be resolved in run", async () => {
		apiMocks.getExistingSP.mockResolvedValue(null);
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ spClientId: "client-z" })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect(latest?.steps.find((s) => s.id === "rg-rbac")?.status).toBe("error");
			expect(latest?.steps.find((s) => s.id === "rg-rbac")?.detail).toContain(
				"Service principal for app client-z not found",
			);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("marks current step error with generic Failed message for non-Error throws", async () => {
		apiMocks.ensureResourceGroup.mockRejectedValue("bad");
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect(latest?.steps.find((s) => s.id === "rg")?.status).toBe("error");
			expect(latest?.steps.find((s) => s.id === "rg")?.detail).toBe("Failed");
			expect(latest?.running).toBe(false);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("reset clears steps, local result and persisted storage", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await act(async () => {
			await latest?.run();
		});

		await waitFor(() => {
			expect((latest?.steps.length ?? 0) > 0).toBe(true);
			expect(localStorage.getItem("zeninstaller_infra_result")).not.toBeNull();
		});

		await act(async () => {
			latest?.reset();
		});

		expect(latest?.steps).toEqual([]);
		expect(localStorage.getItem("zeninstaller_infra_result")).toBeNull();

		await act(async () => {
			root.unmount();
		});
	});

	it("computes warning/complete/error status and summary from config and done state", async () => {
		let latest: UseCoreInfraCard | null = null;
		const root = createRoot(document.createElement("div"));

		apiMocks.hasRbacRoleAtScope.mockResolvedValueOnce(false);
		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps()}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.status).toBe("warning");
			expect(latest?.summary).toBe("Set up corp infrastructure");
		});

		apiMocks.hasRbacRoleAtScope.mockResolvedValueOnce(true);
		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ tenantId: "tenant-2" })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.status).toBe("complete");
			expect(latest?.summary).toBe("Infrastructure ready");
		});

		configMocks.azureClientId = "";
		await act(async () => {
			root.render(
				<HookHarness
					{...baseProps({ tenantId: "tenant-3" })}
					onUpdate={(value) => {
						latest = value;
					}}
				/>,
			);
		});

		await waitFor(() => {
			expect(latest?.status).toBe("error");
			expect(latest?.summary).toBe("Unavailable");
		});

		await act(async () => {
			root.unmount();
		});
	});
});
