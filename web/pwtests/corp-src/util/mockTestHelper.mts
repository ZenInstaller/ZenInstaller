import { expect, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { AZURE_MANAGEMENT_SCOPE, AZURE_MANAGEMENT_URL, CORP_URL, GITHUB_API_URL, GRAPH_APPLICATION_SCOPE, GRAPH_APP_ROLE_ASSIGNMENT_SCOPE, MICROSOFT_GRAPH_URL, MICROSOFT_LOGIN_URL, MOCK_BACKEND_URL } from "../../testInit";
import { expandAzureLoginCard, expandAzureSubscriptionCard, expandRepoCard,} from "./cardHelper.mts";
import { createNewRepo,} from "./testHelper.mts";

const mockUser = { login: "mock-user", id: 12345 };
const mockTenantId = "00000000-0000-0000-0000-000000000001";
const mockSubscriptionId = "mock-subscription";
const mockAppId = "00000000-0000-0000-0000-000000000002";
const mockAppObjectId = "00000000-0000-0000-0000-000000000003";
const mockSpObjectId = "00000000-0000-0000-0000-000000000004";

type MockGitHubOptions = {
	initialVariables?: Record<string, string>;
};

export type MockGitHubState = {
	variables: Record<string, string>;
	repositoryName: string | null;
	branches: Set<string>;
};

export type MockAzureState = {
	appDisplayName: string | null;
	servicePrincipalCreated: boolean;
	federatedSubjects: Set<string>;
	rbacAssigned: boolean;
};

async function json(route: Route, body: unknown, status = 200) {
	await route.fulfill({
		status,
		contentType: "application/json",
		body: JSON.stringify(body),
	});
}

export function coreInfraStepLabels(companyShortCode: string) {
	return [
		"Confirm Microsoft permissions",
		"Register required Azure resource providers",
		`Create resource group root-${companyShortCode}`,
		"Grant GitHub Actions access to the resource group",
		`Create Log Analytics workspace ${companyShortCode}-law`,
		"Configure subscription activity-log diagnostics",
		`Create Application Insights ${companyShortCode}-appinsights`,
		`Create storage account ${companyShortCode}pvt`,
		"Create terraformstate container",
		"Grant GitHub Actions access to Terraform state",
	];
}

export async function expectSuccessfulSteps(card: Locator, labels: string[]) {
	for (const label of labels) {
		const row = card.getByText(label, { exact: true }).locator("../..");
		await expect(row.locator('svg[data-testid="CheckCircleOutlineIcon"], svg[data-testid="RemoveCircleOutlineIcon"]')).toHaveCount(1);
		await expect(row.locator('svg[data-testid="ErrorOutlineIcon"]')).toHaveCount(0);
		await expect(row.getByRole("progressbar")).toHaveCount(0);
	}
}

export type CoreInfraAzureMockState = {
	createdResources: Set<string>;
	roleAssignments: Map<string, Set<string>>;
};

export async function installCoreInfraAzureMock(page: Page): Promise<CoreInfraAzureMockState> {
	const state: CoreInfraAzureMockState = {
		createdResources: new Set(),
		roleAssignments: new Map(),
	};

	const resourceKey = (path: string) => {
		if (/^\/subscriptions\/[^/]+\/resourcegroups\/root-pwtests$/i.test(path)) return "resource-group";
		if (/\/workspaces\/pwtests-law$/i.test(path)) return "log-analytics";
		if (/\/diagnosticsettings\/standard-diagnostics-setting$/i.test(path)) return "diagnostics";
		if (/\/components\/pwtests-appinsights$/i.test(path)) return "app-insights";
		if (/\/storageaccounts\/pwtestspvt$/i.test(path)) return "storage-account";
		if (/\/containers\/terraformstate$/i.test(path)) return "storage-container";
		return null;
	};

	await page.route(`${AZURE_MANAGEMENT_URL}/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const normalizedPath = path.toLowerCase();
		const method = request.method();

		if (normalizedPath.endsWith("/locations") && method === "GET") {
			return json(route, {
				value: [{ name: "australiaeast", displayName: "Australia East", metadata: { regionType: "Physical" } }],
			});
		}

		if (/^\/subscriptions\/[^/]+\/providers\/microsoft\.[^/]+$/i.test(path)) {
			return json(route, { registrationState: "Registered" });
		}

		if (normalizedPath.endsWith("/checknameavailability") && method === "POST") {
			return json(route, { nameAvailable: true });
		}

		const roleAssignmentsMarker = "/providers/microsoft.authorization/roleassignments";
		const roleAssignmentsIndex = normalizedPath.indexOf(roleAssignmentsMarker);
		if (roleAssignmentsIndex >= 0) {
			const scope = normalizedPath.slice(0, roleAssignmentsIndex);
			if (method === "GET") {
				const roleIds = state.roleAssignments.get(scope) ?? new Set<string>();
				return json(route, {
					value: [...roleIds].map((roleId) => ({
						properties: { roleDefinitionId: `/providers/Microsoft.Authorization/roleDefinitions/${roleId}` },
					})),
				});
			}
			if (method === "PUT") {
				const body = request.postDataJSON() as { properties?: { roleDefinitionId?: string } };
				const roleId = body.properties?.roleDefinitionId?.split("/").pop()?.toLowerCase();
				if (roleId) {
					const roleIds = state.roleAssignments.get(scope) ?? new Set<string>();
					roleIds.add(roleId);
					state.roleAssignments.set(scope, roleIds);
				}
				return json(route, {});
			}
		}

		const key = resourceKey(normalizedPath);
		if (key) {
			if (method === "GET") {
				if (!state.createdResources.has(key)) {
					return json(route, { error: { code: "ResourceNotFound" } }, 404);
				}
				return json(route, { id: path, properties: { provisioningState: "Succeeded" } });
			}
			if (method === "PUT") {
				state.createdResources.add(key);
				return json(route, { id: path, properties: { provisioningState: "Succeeded" } });
			}
		}

		return route.fallback();
	});

	return state;
}

export async function installMockGitHub(page: Page, context: BrowserContext, options: MockGitHubOptions = {}): Promise<MockGitHubState> {
	await context.addInitScript(() => {
		sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "direct", token: "ghp_mock" }));
	});

	const state: MockGitHubState = {
		variables: { ...options.initialVariables },
		repositoryName: null,
		branches: new Set(["main"]),
	};

	await page.route(`${GITHUB_API_URL}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;

		if (["HEAD", "OPTIONS"].includes(request.method())) {
			await route.continue();
			return;
		}

		if (path === "/user" && request.method() === "GET") return json(route, mockUser);
		if (path === "/user/orgs" && request.method() === "GET") return json(route, []);
		if (/^\/(?:user\/repos|orgs\/[^/]+\/repos)$/.test(path) && request.method() === "GET") {
			const repositories = [
				{ id: 111111, name: "existing-unrelated-repo", owner: { type: "User" } },
			];
			if (state.repositoryName) {
				repositories.push({
					id: 987654321,
					name: state.repositoryName,
					owner: { type: "User" },
				});
			}
			return json(route, repositories);
		}
		if (path === "/repos/ZenMe-AU/ZenbloxCore/generate" && request.method() === "POST") {
			const body = request.postDataJSON() as { name: string };
			state.repositoryName = body.name;
			return json(route, { id: 987654321, name: body.name }, 201);
		}
		const variableMatch = path.match(/^\/repos\/[^/]+\/[^/]+\/environments\/[^/]+\/variables(?:\/([^/]+))?$/);
		if (variableMatch) {
			const variableName = variableMatch[1];
			if (request.method() === "GET") {
				return json(route, {
					total_count: Object.keys(state.variables).length,
					variables: Object.entries(state.variables).map(([name, value]) => ({ name, value })),
				});
			}
			if (request.method() === "POST") {
				const body = request.postDataJSON() as { name: string; value: string };
				state.variables[body.name] = body.value;
				return json(route, {}, 201);
			}
			if (request.method() === "PATCH" && variableName) {
				const body = request.postDataJSON() as { value: string };
				state.variables[variableName] = body.value;
				return json(route, {});
			}
			if (request.method() === "DELETE" && variableName) {
				delete state.variables[variableName];
				return route.fulfill({ status: 204 });
			}
		}
		if (path.includes("/environments") && request.method() === "GET") {
			return json(route, { total_count: 2, environments: [
				{ name: "PROD", id: 1001 },
				{ name: "TEST", id: 1002 },
			] });
		}
		if (/\/environments\/(?:PROD|TEST)$/.test(path) && request.method() === "PUT") return json(route, {});
		if (path.endsWith("/branches") && request.method() === "GET") {
			return json(route, Array.from(state.branches, (name) => ({
				name,
				commit: { sha: `${name.toLowerCase()}-mock-sha` },
				protected: name === "main",
			})));
		}
		if (/\/git\/ref\/heads\/[^/]+$/.test(path) && request.method() === "GET") {
			const branch = path.split("/").pop() ?? "main";
			return json(route, { object: { sha: `${branch.toLowerCase()}-mock-sha` } });
		}
		if (path.endsWith("/git/refs") && request.method() === "POST") {
			const body = request.postDataJSON() as { ref: string };
			state.branches.add(body.ref.replace("refs/heads/", ""));
			return json(route, {}, 201);
		}
		if (path.endsWith("/actions/oidc/customization/sub") && request.method() === "PUT") return json(route, {});
		if (request.method() === "GET" && path.startsWith("/repos/")) {
			return json(route, {
				id: 987654321,
				name: state.repositoryName ?? path.split("/")[3],
				template_repository: { full_name: "ZenMe-AU/ZenbloxCore" },
			});
		}
		if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
			throw new Error(`Unexpected GitHub write request blocked: ${request.method()} ${request.url()}`);
		}
		await route.abort("blockedbyclient");
	});

	return state;
}

export async function installMockBackend(page: Page, context?: BrowserContext) {
	if (context) {
		await context.addInitScript(() => {
			sessionStorage.setItem("zeninstaller_github_auth", JSON.stringify({ mode: "backend" }));
		});
	}
	const variables: Record<string, string> = {};
	await page.route(`${MOCK_BACKEND_URL}/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === "/getUser") return json(route, { user: mockUser });
		if (path === "/getOrgs") return json(route, { orgList: [] });
		if (path === "/getRepos") return json(route, { repoList: [] });
		if (path === "/checkTemplate") return json(route, { isTemplate: true, templateName: "ZenMe-AU/ZenbloxCore" });
		if (path === "/getBranches") return json(route, { branches: [] });
		if (path === "/generateRepo") {
			return json(route, {
				data: { id: 987654321, name: "mock-repository" },
				envSuccess: true,
				results: { envs: [] },
			}, 200);
		}
		if (path === "/createBranch") return json(route, { branch: { name: "PROD", commit: "mock-sha", protected: false } });
		if (path === "/getVariables") return json(route, { variables });
		if (path === "/createVariable" || path === "/updateVariable") {
			const body = request.postDataJSON() as { name: string; value: string };
			variables[body.name] = body.value;
			return json(route, {});
		}
		if (path === "/deleteVariable") {
			const body = request.postDataJSON() as { name: string };
			delete variables[body.name];
			return json(route, {});
		}
		if (path === "/logout") return json(route, {});
		return json(route, {});
	});
}

export async function installMockAzure(page: Page): Promise<MockAzureState> {
	const state: MockAzureState = {
		appDisplayName: null,
		servicePrincipalCreated: false,
		federatedSubjects: new Set(),
		rbacAssigned: false,
	};

	await page.route(`${AZURE_MANAGEMENT_URL}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith("/subscriptions")) {
			return json(route, {
				value: [{ subscriptionId: mockSubscriptionId, displayName: "Mock subscription", tenantId: mockTenantId, state: "Enabled" }],
			});
		}
		if (path.endsWith("/tenants")) return json(route, { value: [{ tenantId: mockTenantId, displayName: "Mock tenant" }] });
		if (path.includes("/roleAssignments") && route.request().method() === "GET") {
			return json(route, {
				value: state.rbacAssigned
					? [{ properties: { roleDefinitionId: "/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7" } }]
					: [],
			});
		}
		if (path.includes("/roleAssignments/") && route.request().method() === "PUT") {
			state.rbacAssigned = true;
			return json(route, {});
		}
		return json(route, {});
	});
	await page.route(`${MICROSOFT_GRAPH_URL}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		if (path === "/v1.0/applications" && request.method() === "GET") {
			const filter = url.searchParams.get("$filter") ?? "";
			if (filter.startsWith("displayName eq")) return json(route, { value: state.appDisplayName ? [{ appId: mockAppId, id: mockAppObjectId }] : [] });
			if (filter.startsWith("appId eq")) return json(route, { value: state.appDisplayName ? [{ displayName: state.appDisplayName }] : [] });
		}
		if (path === "/v1.0/applications" && request.method() === "POST") {
			const body = request.postDataJSON() as { displayName: string };
			state.appDisplayName = body.displayName;
			return json(route, { appId: mockAppId, id: mockAppObjectId }, 201);
		}
		if (path === "/v1.0/servicePrincipals" && request.method() === "GET") return json(route, { value: state.servicePrincipalCreated ? [{ id: mockSpObjectId }] : [] });
		if (path === "/v1.0/servicePrincipals" && request.method() === "POST") {
			state.servicePrincipalCreated = true;
			return json(route, { id: mockSpObjectId }, 201);
		}
		if (path.endsWith("/federatedIdentityCredentials") && request.method() === "GET") return json(route, { value: Array.from(state.federatedSubjects, (subject) => ({ subject })) });
		if (path.endsWith("/federatedIdentityCredentials") && request.method() === "POST") {
			const body = request.postDataJSON() as { subject: string };
			state.federatedSubjects.add(body.subject);
			return json(route, {}, 201);
		}
		if (request.method() === "GET") return json(route, { value: [] });
		return json(route, {}, 201);
	});

	return state;
}

export async function signInMockAzure(page: Page) {
	const localUrl = page.url();
	await page.route(`${MICROSOFT_LOGIN_URL}/**`, async (route) => {
		await route.abort("blockedbyclient");
	});
	const authorizeRequest = page.waitForRequest((request) => {
		const url = new URL(request.url());
		return url.hostname === "login.microsoftonline.com" && url.searchParams.has("client_id");
	});
	await page.getByRole("button", { name: "Sign in with Azure", exact: true }).click();
	const clientId = new URL((await authorizeRequest).url()).searchParams.get("client_id");
	if (!clientId) throw new Error("The mocked Azure sign-in did not include a client ID.");

	await page.goto(localUrl);
	await page.evaluate(({ clientId, tenantId, azureManagementScope, graphApplicationScope, graphAppRoleAssignmentScope }) => {
		const environment = "login.microsoftonline.com";
		const homeAccountId = `mock-home.${tenantId}`;
		const accountKey = `msal.3|${homeAccountId}|${environment}|${tenantId}`.toLowerCase();
		const accessTokenKey = ["msal.3", homeAccountId, environment, "accesstoken", clientId, tenantId, azureManagementScope, ""].join("|").toLowerCase();
		const graphTarget = [graphApplicationScope, graphAppRoleAssignmentScope].join(" ");
		const graphAccessTokenKey = ["msal.3", homeAccountId, environment, "accesstoken", clientId, tenantId, graphTarget, ""].join("|").toLowerCase();
		const now = Math.floor(Date.now() / 1000);
		const username = "mock-user@example.com";

		for (const key of Object.keys(sessionStorage)) {
			if (key.startsWith("msal.")) sessionStorage.removeItem(key);
		}

		sessionStorage.setItem("msal.3.account.keys", JSON.stringify([accountKey]));
		sessionStorage.setItem(accountKey, JSON.stringify({
			homeAccountId,
			environment,
			realm: tenantId,
			localAccountId: "mock-user-id",
			username,
			authorityType: "MSSTS",
			name: "Mock Azure User",
			tenantProfiles: [{ tenantId, localAccountId: "mock-user-id", username, name: "Mock Azure User", isHomeTenant: true }],
		}));
		sessionStorage.setItem(`msal.3.token.keys.${clientId}`, JSON.stringify({ idToken: [], accessToken: [accessTokenKey, graphAccessTokenKey], refreshToken: [] }));
		const token = {
			homeAccountId,
			credentialType: "AccessToken",
			secret: "mock-access-token",
			cachedAt: now.toString(),
			expiresOn: (now + 3600).toString(),
			extendedExpiresOn: (now + 7200).toString(),
			environment,
			clientId,
			realm: tenantId,
			target: azureManagementScope,
			tokenType: "Bearer",
		};
		sessionStorage.setItem(accessTokenKey, JSON.stringify(token));
		sessionStorage.setItem(graphAccessTokenKey, JSON.stringify({ ...token, target: graphTarget }));
	}, {
		clientId,
		tenantId: mockTenantId,
		azureManagementScope: AZURE_MANAGEMENT_SCOPE,
		graphApplicationScope: GRAPH_APPLICATION_SCOPE,
		graphAppRoleAssignmentScope: GRAPH_APP_ROLE_ASSIGNMENT_SCOPE,
	});

	await page.reload();
}

export { mockSubscriptionId, mockTenantId };

export async function prepareMockAzureSubscription(
	page: Page,
	context: BrowserContext,
	repoName: string,
	options: { initialVariables?: Record<string, string>; saveVariables?: boolean } = {},
) {
	const github = await installMockGitHub(page, context, { initialVariables: options.initialVariables });
	const azure = await installMockAzure(page);
	await page.goto(CORP_URL);

	const azureLoginCard = await expandAzureLoginCard(page);
	await signInMockAzure(page);
	await expect(azureLoginCard.getByText(/Signed in as/i)).toBeVisible();
	const tenantSelect = azureLoginCard.getByTestId("tenant-select");
	await expect(tenantSelect).toBeVisible();
	await tenantSelect.click();
	await page.getByRole("option", { name: /Mock tenant/i }).click();

	const repoCard = await expandRepoCard(page);
	await createNewRepo(page, repoCard, repoName);
	await expect(repoCard.getByText("Loading environments...", { exact: true })).toBeHidden();
	const prodEnvironment = repoCard.getByText("PROD", { exact: true });
	await expect(prodEnvironment).toBeVisible();
	await prodEnvironment.click();
	const createProdButton = repoCard.getByRole("button", { name: "Create New Branch: PROD" });
	if (await createProdButton.isVisible()) {
		await createProdButton.click();
		await expect(createProdButton).toBeHidden();
	}

	const azureSubscriptionCard = await expandAzureSubscriptionCard(page);
	await expect(azureSubscriptionCard.getByText("Loading subscriptions...", { exact: true })).toBeHidden();
	await expect(azureSubscriptionCard.getByRole("combobox")).toBeVisible();

	if (options.saveVariables) {
		const saveButton = azureSubscriptionCard.getByRole("button", { name: "Save 2 variables" });
		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(azureSubscriptionCard.getByRole("button", { name: /^Save\s+variables$/ })).toBeDisabled();
	}

	const tenantVariableInput = azureSubscriptionCard
		.getByText("AZURE_TENANT_ID", { exact: true })
		.locator("..")
		.locator("..")
		.getByRole("textbox");
	const subscriptionVariableInput = azureSubscriptionCard
		.getByText("AZURE_SUBSCRIPTION_ID", { exact: true })
		.locator("..")
		.locator("..")
		.getByRole("textbox");
	const saveButton = azureSubscriptionCard.getByRole("button", { name: "Save variables", exact: true });

	return {
		azureLoginCard,
		azureSubscriptionCard,
		repoCard,
		tenantVariableInput,
		subscriptionVariableInput,
		saveButton,
		github,
		azure,
	};
}

export const savedAzureVariables = { AZURE_TENANT_ID: mockTenantId, AZURE_SUBSCRIPTION_ID: mockSubscriptionId };
