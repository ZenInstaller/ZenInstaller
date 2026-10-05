import { type BrowserContext, type Page } from "@playwright/test";
import { AZURE_MANAGEMENT_URL, CORP_URL, MICROSOFT_GRAPH_URL, TEST_REPO_MAIN } from "../../testInit";
import {
	installCoreInfraAzureMock, installMockAzure, installMockGitHub, mockSubscriptionId, mockTenantId,
} from "./mockTestHelper.mts";
import { openRemoteTerminalCard } from "./RemoteTerminalInfraCardHelper.mts";

export async function installRelayNetworkGuard(context: BrowserContext) {
	const unexpectedRequests: string[] = [];
	await context.route("**/*", async (route) => {
		if (new URL(route.request().url()).origin === new URL(CORP_URL).origin) return route.continue();
		unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
		await route.abort("blockedbyclient");
	});
	await context.route("https://js.monitor.azure.com/scripts/b/ai.config.1.cfg.json", (route) =>
		route.fulfill({ json: { enabled: false } }));
	await context.route("https://australiaeast-1.in.applicationinsights.azure.com/v2/track", (route) =>
		route.fulfill({ json: { itemsReceived: 0, itemsAccepted: 0, errors: [] } }));
	return unexpectedRequests;
}

export async function prepareMockRelay(
	page: Page, context: BrowserContext, viewportName: string, options: { failProvisioningOnce?: boolean } = {},
) {
	const unexpectedRequests = await installRelayNetworkGuard(context);
	// Substitute only Vite's authentication module, leaving the real card and workflow running.
	await page.route(/\/corp-src\/cards\/AzureLogin\/msal\.ts(?:\?.*)?$/, (route) => route.fulfill({
		contentType: "application/javascript",
		body: `
			export const MSA_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
			const account = { homeAccountId: "mock-home", environment: "login.microsoftonline.com",
				tenantId: "${mockTenantId}", localAccountId: "mock-user", username: "mock-user@example.com",
				name: "Mock Azure User", tenantProfiles: new Map() };
			const reject = async () => { throw new Error("Unexpected authentication redirect in relay mock"); };
			export const getMsal = async () => ({ handleRedirectPromise: async () => null,
				getAllAccounts: () => [account], acquireTokenSilent: async () => ({ account, accessToken: "mock-token" }),
				loginRedirect: reject, acquireTokenRedirect: reject, clearCache: async () => {} });
			export const ensureScopeConsent = async () => false;
			export const getToken = async () => "mock-token";
			let active;
			export const setActiveAzureIdentity = value => { active = value; };
			export const getMsToken = async () => active ? "mock-token" : null;
			export const requireMsToken = async () => {
				if (!active) throw new Error("No mocked account selected");
				return "mock-token";
			};
		`,
	}));
	const repoName = `${TEST_REPO_MAIN}-${viewportName}`;
	const corpName = "pwtests";
	const clientId = "00000000-0000-0000-0000-000000000002";
	await context.addInitScript(({ clientId, tenantId, subscriptionId, corpName }) => {
		localStorage.setItem("zeninstaller_azure_result", JSON.stringify({ clientId, tenantId, subscriptionIds: [subscriptionId] }));
		localStorage.setItem("zeninstaller_infra_result", JSON.stringify({ corpName, subscriptionId }));
		sessionStorage.setItem("zeninstaller_arm_tenant", tenantId);
	}, { clientId, tenantId: mockTenantId, subscriptionId: mockSubscriptionId, corpName });
	const github = await installMockGitHub(page, context, {
		repositoryName: repoName, branches: ["main", "PROD"],
		initialVariables: {
			NAME: corpName, AZURE_TENANT_ID: mockTenantId, AZURE_SUBSCRIPTION_ID: mockSubscriptionId,
			AZURE_CLIENT_ID: clientId, AZURE_PLAN_CLIENT_ID: clientId,
		},
	});
	const azure = await installMockAzure(page, {
		appDisplayName: "zeninstaller-pwtests", servicePrincipalCreated: true, rbacAssigned: true,
	});
	const pipelineClientId = "00000000-0000-0000-0000-000000000005";
	let pipelineCreated = false;
	let pipelineSpCreated = false;
	await page.route(`${MICROSOFT_GRAPH_URL}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const filter = url.searchParams.get("$filter") ?? "";
		if (url.pathname === "/v1.0/applications" && request.method() === "GET" &&
			filter === "displayName eq 'pwtests-terminal-pipeline'") {
			return route.fulfill({ json: { value: pipelineCreated ? [{ id: "mock-pipeline-app", appId: pipelineClientId }] : [] } });
		}
		if (url.pathname === "/v1.0/applications" && request.method() === "POST") {
			const body = request.postDataJSON() as { displayName: string };
			if (body.displayName === "pwtests-terminal-pipeline") {
				pipelineCreated = true;
				return route.fulfill({ status: 201, json: { id: "mock-pipeline-app", appId: pipelineClientId } });
			}
		}
		if (url.pathname === "/v1.0/servicePrincipals" && request.method() === "GET" &&
			filter === `appId eq '${pipelineClientId}'`) {
			return route.fulfill({ json: { value: pipelineSpCreated ? [{ id: "mock-pipeline-principal" }] : [] } });
		}
		if (url.pathname === "/v1.0/servicePrincipals" && request.method() === "POST") {
			const body = request.postDataJSON() as { appId: string };
			if (body.appId === pipelineClientId) {
				pipelineSpCreated = true;
				return route.fulfill({ status: 201, json: { id: "mock-pipeline-principal" } });
			}
		}
		return route.fallback();
	});
	const core = await installCoreInfraAzureMock(page);
	core.createdResources.add("resource-group");
	core.roleAssignments.set(`/subscriptions/${mockSubscriptionId}/resourcegroups/root-pwtests`,
		new Set(["acdd72a7-3385-48ef-bd42-f606fba81ae7"]));
	const resources = new Map<string, Record<string, unknown>>();
	const writes: { path: string; body: Record<string, unknown> }[] = [];
	type RoleAssignment = { properties: { principalId: string; roleDefinitionId: string; principalType: string } };
	const roles = new Map<string, RoleAssignment[]>();
	let provisioningFailed = false;
	await page.route(`${AZURE_MANAGEMENT_URL}/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.toLowerCase();
		if (path.endsWith("/sites/pwtests-terminal-app/config/appsettings/list") && request.method() === "POST") {
			// The backend card checks deployment status; this test provisions infrastructure, not backend code.
			return route.fulfill({ json: { properties: {
				ALLOWED_ORIGINS: new URL(CORP_URL).origin,
				WEBPUBSUB_ENDPOINT: "pwtests-wpubsub.webpubsub.azure.com",
				HUB_NAME: "terminal",
				SESSION_TABLE_ACCOUNT_NAME: "pwteststerm",
				SESSION_TABLE_NAME: "sessions",
			} } });
		}
		const roleMarker = "/providers/microsoft.authorization/roleassignments";
		const roleIndex = path.indexOf(roleMarker);
		if (roleIndex >= 0 && !path.slice(0, roleIndex).endsWith("/resourcegroups/root-pwtests") &&
			!path.slice(0, roleIndex).endsWith(`/subscriptions/${mockSubscriptionId}`)) {
			const scope = path.slice(0, roleIndex);
			if (request.method() === "GET") {
				const filter = new URL(request.url()).searchParams.get("$filter") ?? "";
				const principalId = /^assignedTo\('([^']+)'\)$/.exec(filter)?.[1];
				if (!principalId) throw new Error(`Unexpected role-assignment filter: ${filter}`);
				return route.fulfill({ json: { value: (roles.get(scope) ?? []).filter(
					(assignment) => assignment.properties.principalId === principalId,
				) } });
			}
			if (request.method() === "PUT") {
				const body = request.postDataJSON() as RoleAssignment;
				roles.set(scope, [...(roles.get(scope) ?? []), body]);
				writes.push({ path, body });
				return route.fulfill({ json: body });
			}
		}
		if (!/\/(?:workspaces\/pwtests-terminal-law|components\/pwtests-terminal-ai|storageaccounts\/pwteststerm|webpubsub\/pwtests-wpubsub|serverfarms\/pwtests-terminal-app-plan|sites\/pwtests-terminal-app)(?:\/|$)/.test(path)) {
			return route.fallback();
		}
		if (request.method() === "GET") {
			return resources.has(path)
				? route.fulfill({ json: resources.get(path) })
				: route.fulfill({ status: 404, json: { error: { code: "ResourceNotFound" } } });
		}
		if (request.method() === "PUT") {
			if (options.failProvisioningOnce && !provisioningFailed && path.endsWith("/components/pwtests-terminal-ai")) {
				provisioningFailed = true;
				return route.fulfill({ status: 403, json: {
					error: { code: "AuthorizationFailed", message: "Mock provisioning permission denied" },
				} });
			}
			const body = request.postDataJSON() as Record<string, unknown>;
			writes.push({ path, body });
			const resource = {
				...body, id: path, properties: { provisioningState: "Succeeded" },
				identity: { type: "SystemAssigned", principalId: "mock-function-principal" },
			};
			resources.set(path, resource);
			return route.fulfill({ json: resource });
		}
		unexpectedRequests.push(`${request.method()} ${request.url()}`);
		await route.abort("blockedbyclient");
	});
	const url = new URL(CORP_URL);
	url.search = new URLSearchParams({
		account: "mock-user", repo: repoName, env: "PROD", tenant: mockTenantId, subscription: mockSubscriptionId,
	}).toString();
	await page.goto(url.toString());
	return { card: await openRemoteTerminalCard(page), corpName, tenantId: mockTenantId,
		github, azure, resources, writes, unexpectedRequests };
}
