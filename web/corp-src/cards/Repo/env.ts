import type { Branch, GhEnv } from "../../types";

export function isValidEnvName(name: string, validEnvs: readonly string[]): boolean {
  return validEnvs.some((v) => v.toLowerCase() === name.toLowerCase());
}

export type EnvMatchResult =
  | { status: "exact"; env: GhEnv }
  | { status: "case"; env: GhEnv }
  | { status: "multiple"; envs: GhEnv[] }
  | { status: "none" };

export function matchEnv(name: string, envList: GhEnv[], validEnvs: readonly string[]): EnvMatchResult {
  const filtered = envList.filter((e) => isValidEnvName(e.name, validEnvs));
  const matches = filtered.filter((e) => e.name.toLowerCase() === name.toLowerCase());
  if (matches.length === 0) return { status: "none" };
  if (matches.length > 1) return { status: "multiple", envs: matches };
  const match = matches[0];
  return match.name === name ? { status: "exact", env: match } : { status: "case", env: match };
}

export type BranchMatchResult =
  | { status: "exact"; branch: Branch }
  | { status: "case"; branch: Branch }
  | { status: "multiple"; branches: Branch[] }
  | { status: "none" };

export function matchBranch(envName: string, branches: Branch[]): BranchMatchResult {
  const matches = branches.filter((b) => b.name.toLowerCase() === envName.toLowerCase());
  if (matches.length === 0) return { status: "none" };
  if (matches.length > 1) return { status: "multiple", branches: matches };
  const match = matches[0];
  return match.name === envName ? { status: "exact", branch: match } : { status: "case", branch: match };
}
