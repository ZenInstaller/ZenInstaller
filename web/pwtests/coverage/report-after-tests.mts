import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullResult, Reporter } from "@playwright/test/reporter";

const execFileAsync = promisify(execFile);
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const coverageScript = resolve(webDir, "pwtests", "coverage", "playwright-coverage.mjs");
const coverageReport = resolve(webDir, "pwtests/coverage-report/index.html");

//TODO: AI-generated and is OS-dependant
async function openCoverageReport(): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", "start", "", coverageReport]);
  } else {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    await execFileAsync(opener, [coverageReport]);
  }
}

export default class CoverageReporter implements Reporter {
  async onEnd(_result: FullResult): Promise<void> {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [coverageScript],
      { cwd: webDir },
    );

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    await openCoverageReport();
  }
}
