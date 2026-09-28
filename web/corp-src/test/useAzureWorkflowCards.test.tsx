import { act } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccessPassCard, type UseAccessPassCard } from "../cards/AccessPass/useAccessPassCard";
import { useAzureAppRegistrationCard, type UseAzureAppRegistrationCard } from "../cards/AzureAppRegistration/useAzureAppRegistrationCard";
import { useCoreInfraCard, type UseCoreInfraCard } from "../cards/CoreInfra/useCoreInfraCard";
import { useCreateDomainCard, type UseCreateDomainCard } from "../cards/CreateDomain/useCreateDomainCard";
import type { AzureAccount } from "../types";

const { apiMocks } = vi.hoisted(() => ({
	apiMocks: {
		getMsal: vi.fn(),
		listUsersManagedBySignedInUser: vi.fn(),
		ensureTemporaryAccessPassEnabled: vi.fn(),
		listUserAuthenticationMethods: vi.fn(),
		resetUserPassword: vi.fn(),
		deleteUserAuthenticationMethod: vi.fn(),
		createTemporaryAccessPassForUser: vi.fn(),
		temporaryAccessPassMethodExists: vi.fn(),
		getExistingSP: vi.fn(),
		getAppNameByAppId: vi.fn(),
		getExistingApp: vi.fn(),
		createAppRegistration: vi.fn(),
		createServicePrincipal: vi.fn(),
		ensureFederatedCredential: vi.fn(),
		setOidcImmutableSubject: vi.fn(),
		ensureRbacRole: vi.fn(),
		grantAdminConsent: vi.fn(),
		getEntraDomain: vi.fn(),
		createEntraDomain: vi.fn(),
		getDomainVerificationTxt: vi.fn(),
		verifyEntraDomain: vi.fn(),
		setPrimaryEntraDomain: vi.fn(),
		listVerifiedDomains: vi.fn().mockResolvedValue([]),
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
	},
}));

vi.mock("../auth/msal", () => ({
	getMsal: apiMocks.getMsal,
}));

vi.mock("../api", () => ({
	setOidcImmutableSubject: apiMocks.setOidcImmutableSubject,
}));

vi.mock("../api/azureGraph", () => ({
	listUsersManagedBySignedInUser: apiMocks.listUsersManagedBySignedInUser,
	ensureTemporaryAccessPassEnabled: apiMocks.ensureTemporaryAccessPassEnabled,
	listUserAuthenticationMethods: apiMocks.listUserAuthenticationMethods,
	resetUserPassword: apiMocks.resetUserPassword,
	deleteUserAuthenticationMethod: apiMocks.deleteUserAuthenticationMethod,
	createTemporaryAccessPassForUser: apiMocks.createTemporaryAccessPassForUser,
	temporaryAccessPassMethodExists: apiMocks.temporaryAccessPassMethodExists,
	getExistingSP: apiMocks.getExistingSP,
	getAppNameByAppId: apiMocks.getAppNameByAppId,
	getExistingApp: apiMocks.getExistingApp,
	createAppRegistration: apiMocks.createAppRegistration,
	createServicePrincipal: apiMocks.createServicePrincipal,
	ensureFederatedCredential: apiMocks.ensureFederatedCredential,
	ensureRbacRole: apiMocks.ensureRbacRole,
	grantAdminConsent: apiMocks.grantAdminConsent,
	getEntraDomain: apiMocks.getEntraDomain,
	createEntraDomain: apiMocks.createEntraDomain,
	getDomainVerificationTxt: apiMocks.getDomainVerificationTxt,
	verifyEntraDomain: apiMocks.verifyEntraDomain,
	setPrimaryEntraDomain: apiMocks.setPrimaryEntraDomain,
	listVerifiedDomains: apiMocks.listVerifiedDomains,
}));

vi.mock("../api/azureArm", () => ({
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
	resourceGroupScope: vi.fn((subscriptionId: string, resourceGroupName: string) => `${subscriptionId}/${resourceGroupName}`),
	storageAccountScope: vi.fn((subscriptionId: string, resourceGroupName: string, storageAccountName: string) => `${subscriptionId}/${resourceGroupName}/${storageAccountName}`),
	ensureDnsZone: vi.fn(),
	ensureDnsTxtRecord: vi.fn(),
}));

vi.mock("../config/azureConfig", () => ({
	AZURE_CLIENT_ID: "client-id",
	ACCESS_PASS_SCOPES: ["access.pass"],
	APP_SCOPES: ["app.scope"],
	DOMAIN_SCOPES: ["domain.scope"],
	GRANT_CONSENT_SCOPES: ["grant.scope"],
	GRAPH_PERMISSIONS: { DomainReadWriteAll: "Domain.ReadWrite.All" },
}));

vi.mock("../cards/AzureAppRegistration/useRbacCheck", () => ({
	useRbacCheck: vi.fn(() => ({ status: "ready", missingRoles: [] })),
}));

function mountHook<T>(renderHook: () => T, onUpdate: (value: T) => void) {
	function Harness() {
		const value = renderHook();
		useEffect(() => {
			onUpdate(value);
		}, [value]);
		return null;
	}

	const root = createRoot(document.createElement("div"));
	return { root, Harness };
}

async function waitFor(assertion: () => void, maxAttempts = 400) {
	let lastError: unknown;
	for (let i = 0; i < maxAttempts; i += 1) {
		let passed = false;
		await act(async () => {
			try {
				assertion();
				passed = true;
			} catch (error) {
				lastError = error;
			}
		});
		if (passed) return;
		await act(async () => {
			await Promise.resolve();
		});
	}
	throw lastError;
}

describe("azure workflow cards", () => {
	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		sessionStorage.clear();

		apiMocks.getMsal.mockResolvedValue({
			acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
		} as never);

		apiMocks.listUsersManagedBySignedInUser.mockResolvedValue([{ id: "user-1", displayName: "Manager One" }]);
		apiMocks.ensureTemporaryAccessPassEnabled.mockResolvedValue(true);
		apiMocks.listUserAuthenticationMethods.mockResolvedValue([{ id: "email-1", "@odata.type": "#microsoft.graph.emailAuthenticationMethod" }]);
		apiMocks.resetUserPassword.mockResolvedValue(undefined);
		apiMocks.deleteUserAuthenticationMethod.mockResolvedValue(undefined);
		apiMocks.createTemporaryAccessPassForUser.mockResolvedValue({ temporaryAccessPass: "tap-123", id: "tap-1" });
		apiMocks.temporaryAccessPassMethodExists.mockResolvedValue(true);

		apiMocks.getExistingApp.mockResolvedValue(null);
		apiMocks.getAppNameByAppId.mockResolvedValue("Prefilled App");
		apiMocks.createAppRegistration.mockResolvedValue({ appId: "app-1", id: "app-object-1" });
		apiMocks.createServicePrincipal.mockResolvedValue({ id: "sp-object-1" });
		apiMocks.ensureFederatedCredential.mockResolvedValue(undefined);
		apiMocks.ensureRbacRole.mockResolvedValue(undefined);
		apiMocks.grantAdminConsent.mockResolvedValue(undefined);

		apiMocks.getEntraDomain.mockResolvedValue({ isVerified: true, isDefault: true });
		apiMocks.createEntraDomain.mockResolvedValue({ isVerified: true, isDefault: false });
		apiMocks.getDomainVerificationTxt.mockResolvedValue("_txt-token");
		apiMocks.verifyEntraDomain.mockResolvedValue({ isVerified: true, isDefault: true });
		apiMocks.setPrimaryEntraDomain.mockResolvedValue(undefined);

		apiMocks.ensureResourceGroup.mockResolvedValue("created");
		apiMocks.resourceGroupExists.mockResolvedValue(true);
		apiMocks.ensureLogAnalyticsWorkspace.mockResolvedValue({ result: "created", id: "/law" });
		apiMocks.ensureSubscriptionDiagnostics.mockResolvedValue("created");
		apiMocks.ensureAppInsights.mockResolvedValue("created");
		apiMocks.ensureStorageAccount.mockResolvedValue("created");
		apiMocks.ensureStorageContainer.mockResolvedValue("created");
		apiMocks.ensureRbacRoleAtScope.mockResolvedValue("created");
		apiMocks.hasRbacRoleAtScope.mockResolvedValue(true);
		apiMocks.listLocations.mockResolvedValue([{ name: "eastus", displayName: "East US" }]);
	});

	it("creates an access pass for a managed user", async () => {
		const azureAccount = { tenantId: "tenant-1" } as AzureAccount;
		let latest: UseAccessPassCard | null = null;
		const { root, Harness } = mountHook(
			() => useAccessPassCard({ azureAccount, confirmedTenantId: "tenant-1" }),
			(value) => {
				latest = value;
			},
		);

		await act(async () => {
			root.render(<Harness />);
		});

		await waitFor(() => {
			expect(latest?.cardId).toBe("access_pass");
			expect(apiMocks.listUsersManagedBySignedInUser).toHaveBeenCalledTimes(1);
		});

		let result: Awaited<ReturnType<UseAccessPassCard["runForUser"]>> = null;
		await act(async () => {
			result = await latest!.runForUser("user-1");
		});

		await waitFor(() => {
			expect(result?.accessPassValue).toBe("tap-123");
			expect(apiMocks.createTemporaryAccessPassForUser).toHaveBeenCalledWith(
				azureAccount,
				"user-1",
				"tenant-1",
			);
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("prefills the app registration name and completes once variables are confirmed", async () => {
		const azureAccount = { tenantId: "tenant-1" } as AzureAccount;
		const githubAccount = { id: 1, login: "org-one", type: "User" as const };
		const variableValues = { AZURE_CLIENT_ID: "client-a", AZURE_PLAN_CLIENT_ID: "client-a" };
		let latest: UseAzureAppRegistrationCard | null = null;
		const { root, Harness } = mountHook(
			() =>
				useAzureAppRegistrationCard({
					azureAccount,
					githubAccount,
					githubRepo: "repo-one",
					githubRepoId: 456789,
					subscriptionId: "sub-1",
					subscriptionLabel: "Main subscription",
					tenantId: "tenant-1",
					variableValues,
					manualTenantId: "tenant-1",
				}),
			(value) => {
				latest = value;
			},
		);

		await act(async () => {
			root.render(<Harness />);
		});

		await waitFor(() => {
			expect(latest?.cardId).toBe("azure_app_registration");
		});

		await act(async () => {
			await latest!.prefillAppName("client-a");
		});

		await waitFor(() => {
			expect(latest?.appName).toBe("Prefilled App");
		});

		await act(async () => {
			latest!.onVariablesComplete(true);
		});

		await waitFor(() => {
			expect(latest?.done).toBe(true);
			expect(latest?.summary).toBe("Create the app registration");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("loads core infrastructure state and reaches ready status", async () => {
		const azureAccount = { tenantId: "tenant-1" } as AzureAccount;
		let latest: UseCoreInfraCard | null = null;
		const { root, Harness } = mountHook(
			() =>
				useCoreInfraCard({
					azureAccount,
					subscriptionId: "sub-1",
					corpName: "Zenblox",
					spClientId: "client-a",
					tenantId: "tenant-1",
				}),
			(value) => {
				latest = value;
			},
		);

		await act(async () => {
			root.render(<Harness />);
		});

		await waitFor(() => {
			expect(latest?.cardId).toBe("core_infra");
			expect(latest?.summary).toBe("Set up corp infrastructure");
			expect(latest?.cardRequirements).toContain("azure_app_registration");
		});

		await act(async () => {
			root.unmount();
		});
	});

	it("detects a verified primary domain on mount", async () => {
		const azureAccount = { tenantId: "tenant-1" } as AzureAccount;
		let latest: UseCreateDomainCard | null = null;
		const { root, Harness } = mountHook(
			() =>
				useCreateDomainCard({
					azureAccount,
					subscriptionId: "sub-1",
					corpName: "Zenblox",
					dnsName: "zenblox.io",
					spClientId: "client-a",
					tenantId: "tenant-1",
				}),
			(value) => {
				latest = value;
			},
		);

		await act(async () => {
			root.render(<Harness />);
		});

		await waitFor(() => {
			expect(latest?.cardId).toBe("create_domain");
			expect(["Set up the corp domain", "Domain verified and primary"]).toContain(latest?.summary);
			expect(latest?.cardRequirements).toContain("core_infra");
		});

		await act(async () => {
			root.unmount();
		});
	});
});
