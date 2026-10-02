import { getToken } from "../auth/msal";
import { STORAGE_SCOPES } from "../config/azureConfig";
import type { AzureAccount } from "../types";

const API_VERSION = "2021-08-06";
const WEB_CONTAINER = "$web";

async function blobFetch(
  account: AzureAccount,
  accountName: string,
  path: string,
  init: RequestInit,
  overrideTenantId?: string,
  allowMissing = false,
): Promise<Response | null> {
  const token = await getToken(account, STORAGE_SCOPES, overrideTenantId);
  const res = await fetch(`https://${accountName}.blob.core.windows.net${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "x-ms-version": API_VERSION, ...init.headers },
  });
  if (res.status === 404 && allowMissing) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res;
}

export async function enableStaticWebsite(
  account: AzureAccount,
  accountName: string,
  overrideTenantId?: string,
  indexDocument = "index.html",
): Promise<void> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?><StorageServiceProperties><StaticWebsite>` +
    `<Enabled>true</Enabled><IndexDocument>${indexDocument}</IndexDocument>` +
    `<ErrorDocument404Path>${indexDocument}</ErrorDocument404Path>` +
    `</StaticWebsite></StorageServiceProperties>`;
  await blobFetch(
    account,
    accountName,
    "/?restype=service&comp=properties",
    { method: "PUT", body, headers: { "Content-Type": "application/xml" } },
    overrideTenantId,
  );
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  webmanifest: "application/manifest+json",
};

// A wrong type here means the browser refuses the file, so anything unrecognised is left to download.
export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export type SiteFile = { path: string; body: Blob };

export async function uploadStaticSite(
  account: AzureAccount,
  accountName: string,
  files: SiteFile[],
  overrideTenantId?: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<void> {
  let uploaded = 0;
  for (const file of files) {
    await blobFetch(
      account,
      accountName,
      `/${WEB_CONTAINER}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "PUT",
        body: file.body,
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentTypeFor(file.path) },
      },
      overrideTenantId,
    );
    onProgress?.(++uploaded, files.length);
  }
}

export type DeployedSite = { version: string; sha: string; builtAt: number };

export async function recordDeployedSite(
  account: AzureAccount,
  accountName: string,
  site: DeployedSite,
  overrideTenantId?: string,
): Promise<void> {
  await blobFetch(
    account,
    accountName,
    `/${WEB_CONTAINER}?restype=container&comp=metadata`,
    {
      method: "PUT",
      headers: {
        "x-ms-meta-version": site.version,
        "x-ms-meta-sha": site.sha,
        "x-ms-meta-builtat": String(site.builtAt),
      },
    },
    overrideTenantId,
  );
}

export async function readDeployedSite(
  account: AzureAccount,
  accountName: string,
  overrideTenantId?: string,
): Promise<DeployedSite | null> {
  const res = await blobFetch(
    account,
    accountName,
    `/${WEB_CONTAINER}?restype=container&comp=metadata`,
    { method: "GET" },
    overrideTenantId,
    true,
  );
  const version = res?.headers.get("x-ms-meta-version");
  const sha = res?.headers.get("x-ms-meta-sha");
  if (!version || !sha) return null;
  return { version, sha, builtAt: Number(res?.headers.get("x-ms-meta-builtat") ?? 0) };
}
