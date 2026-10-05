/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { convert } from "ast-v8-to-istanbul";
import { parseAstAsync } from "vite";
import coverageLib from "istanbul-lib-coverage";
import reportLib from "istanbul-lib-report";
import reports from "istanbul-reports";

const { createCoverageMap } = coverageLib;
const { createContext } = reportLib;

const webDir = resolve(".");
const resultsDir = resolve(webDir, "pwtests/test-results");
const reportDir = resolve(webDir, "pwtests/coverage-report");
const coverageMap = createCoverageMap({});
let converted = 0;

async function* findCoverageFiles(dir) {
  let items;

  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const item of items) {
    const file = join(dir, item.name);

    if (item.isDirectory()) {
      yield* findCoverageFiles(file);
    } else if (item.name === "v8-coverage.json") {
      yield file;
    }
  }
}

function sourcePathFromUrl(url) {
  if (url.pathname.startsWith("/@fs/")) {
    return resolve(decodeURIComponent(url.pathname.slice(5)));
  }

  const sourcePath = resolve(webDir, `.${decodeURIComponent(url.pathname)}`);
  const webRelativePath = relative(webDir, sourcePath);
  if (webRelativePath.startsWith("..") || isAbsolute(webRelativePath)) {
    return undefined;
  }

  return sourcePath;
}

for await (const file of findCoverageFiles(resultsDir)) {
  const entries = JSON.parse(await readFile(file, "utf8"));

  for (const entry of entries) {
    if (!entry.source || !entry.url) continue;

    let url;
    try {
      url = new URL(entry.url);
    } catch {
      continue;
    }

    if (url.origin !== "http://localhost:5173") continue;
    if (!/\.[cm]?[jt]sx?$/.test(url.pathname) && !url.pathname.startsWith("/@fs/")) continue;
    if (url.pathname.startsWith("/node_modules/")) continue;

    const sourcePath = sourcePathFromUrl(url);
    if (!sourcePath) continue;

    const istanbulData = await convert({
      ast: await parseAstAsync(entry.source),
      code: entry.source,
      wrapperLength: 0,
      coverage: {
        scriptId: entry.scriptId,
        url: pathToFileURL(sourcePath).href,
        functions: entry.functions,
      },
    });

    coverageMap.merge(istanbulData);
    converted++;
  }
}

if (converted === 0) {
  console.log("No application coverage was collected in this run.");
} else {
  const context = createContext({
    dir: reportDir,
    coverageMap,
  });

  reports.create("html").execute(context);
  reports.create("text-summary").execute(context);
  console.log(`Coverage report: ${join(reportDir, "index.html")}`);
}
