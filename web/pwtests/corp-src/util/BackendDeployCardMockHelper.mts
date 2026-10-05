/// <reference types="node" />
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { AZURE_MANAGEMENT_URL, CORP_URL, GITHUB_API_URL } from "../../testInit";
import { prepareMockRelay } from "./RemoteTerminalInfraCardMockHelper.mts";
import { openBackendCard } from "./BackendDeployCardHelper.mts";

const sha = "abcdef1234567890abcdef1234567890abcdef12";
export const backendBuild = {
	version: "mock-backend-v1", sha, runId: "12345", artifactId: 67890, builtAt: 1_759_622_400,
};

export async function prepareMockBackend(
	page: Page, context: BrowserContext, viewportName: string,
	options: { missingArtifact?: boolean; failUploadOnce?: boolean; failBuild?: boolean } = {},
) {
	await page.clock.install({ time: new Date("2026-10-05T02:00:00Z") });
	await context.addInitScript(() => {
		localStorage.setItem("zeninstaller_remote_terminal_infra_result", JSON.stringify({
			corpName: "pwtests", subscriptionId: "mock-subscription", apiUrl: "https://pwtests-terminal-app.azurewebsites.net",
			webPubSubHost: "pwtests-wpubsub.webpubsub.azure.com", hubName: "terminal",
			pipelineClientId: "00000000-0000-0000-0000-000000000005",
			pipelineTenantId: "00000000-0000-0000-0000-000000000001",
		}));
	});
	const relay = await prepareMockRelay(page, context, viewportName);
	Object.assign(relay.github.variables, {
		BACKEND_API: "https://pwtests-terminal-app.azurewebsites.net",
		WEBPUBSUB_ENDPOINT: "pwtests-wpubsub.webpubsub.azure.com",
		WEBPUBSUB_CLIENT_ID: "00000000-0000-0000-0000-000000000005",
		WEBPUBSUB_TENANT_ID: relay.tenantId,
	});
	const initialVariables = { ...relay.github.variables };
	const state = {
		built: !!options.missingArtifact || !!options.failUploadOnce,
		dispatches: [] as { ref: string; inputs: { github_env_name: string } }[],
		downloads: 0, uploads: 0, settingsWrites: 0,
		settings: {
			ALLOWED_ORIGINS: new URL(CORP_URL).origin, SESSION_TABLE_NAME: "sessions",
			WEBPUBSUB_ENDPOINT: "pwtests-wpubsub.webpubsub.azure.com",
		} as Record<string, string>,
	};
	const zip = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
	await page.route(`${GITHUB_API_URL}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname.endsWith("/deployments") && url.searchParams.get("task") === "build:backend") {
			expect(url.searchParams.get("environment")).toBe("PROD");
			return route.fulfill({ json: state.built ? [{
				payload: { ...backendBuild, artifactId: options.missingArtifact ? null : backendBuild.artifactId },
				created_at: "2025-10-04T08:00:00Z", sha,
			}] : [] });
		}
		if (url.pathname.endsWith("/actions/workflows/buildBackend.yml/dispatches") && request.method() === "POST") {
			state.dispatches.push(request.postDataJSON());
			if (options.failBuild) return route.fulfill({ status: 403, json: { message: "Mock build permission denied" } });
			state.built = true;
			return route.fulfill({ status: 204 });
		}
		if (url.pathname.endsWith(`/actions/artifacts/${backendBuild.artifactId}/zip`)) {
			state.downloads++;
			return route.fulfill({ contentType: "application/zip", body: zip, headers: { "Content-Length": String(zip.length) } });
		}
		if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
			relay.unexpectedRequests.push(`${request.method()} ${request.url()}`);
			return route.abort("blockedbyclient");
		}
		return route.fallback();
	});
	const settingsPath = "/sites/pwtests-terminal-app/config/appsettings";
	await page.route(`${AZURE_MANAGEMENT_URL}/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname.toLowerCase();
		if (path.endsWith(`${settingsPath}/list`) && request.method() === "POST") {
			return route.fulfill({ json: { properties: state.settings } });
		}
		if (path.endsWith(settingsPath) && request.method() === "PUT") {
			state.settingsWrites++;
			state.settings = (request.postDataJSON() as { properties: Record<string, string> }).properties;
			return route.fulfill({ json: { properties: state.settings } });
		}
		if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
			relay.unexpectedRequests.push(`${request.method()} ${request.url()}`);
			return route.abort("blockedbyclient");
		}
		return route.fallback();
	});
	await page.route("https://pwtests-terminal-app.scm.azurewebsites.net/**", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname === "/api/publish" && request.method() === "POST") {
			state.uploads++;
			expect(url.searchParams.get("type")).toBe("zip");
			expect(request.headers()["content-type"]).toBe("application/zip");
			expect(request.postDataBuffer()).toEqual(zip);
			if (options.failUploadOnce && state.uploads === 1) {
				return route.fulfill({ status: 500, body: "Mock upload failure" });
			}
			return route.fulfill({ status: 202, json: {} });
		}
		if (url.pathname === "/api/deployments/latest" && request.method() === "GET") {
			return route.fulfill({ json: { complete: true, status: 4, end_time: "2026-10-05T02:00:00Z" } });
		}
		relay.unexpectedRequests.push(`${request.method()} ${request.url()}`);
		await route.abort("blockedbyclient");
	});
	await page.reload();
	return { ...relay, card: await openBackendCard(page), state, initialVariables };
}
