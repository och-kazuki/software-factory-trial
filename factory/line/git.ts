import { rmSync } from "node:fs";
import { join } from "node:path";
import { execOk } from "./exec.ts";

export function git(cwd: string, args: readonly string[]): string {
  return execOk("git", ["-C", cwd, ...args]);
}

export interface StatusEntry {
  readonly code: string;
  readonly path: string;
}

// `git status --porcelain=v1 -z` の出力を読む。名前の変更は「新しいパス」と「元のパス」の両方を返す
export function parseStatus(output: string): StatusEntry[] {
  const parts = output.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.length < 4) continue;
    const code = part.slice(0, 2);
    entries.push({ code, path: part.slice(3) });
    if (code.includes("R") || code.includes("C")) {
      const original = parts[i + 1];
      if (original !== undefined && original !== "") entries.push({ code, path: original });
      i += 1;
    }
  }
  return entries;
}

export function status(cwd: string): StatusEntry[] {
  return parseStatus(git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
}

export function stagedFiles(cwd: string): string[] {
  return git(cwd, ["diff", "--cached", "--name-only", "-z"])
    .split("\0")
    .filter((s) => s !== "");
}

// 範囲外の変更は、LLM に直させるのではなく機械的に元に戻してから症状として伝える
export function revert(cwd: string, entries: readonly StatusEntry[]): void {
  const untracked = entries.filter((e) => e.code === "??").map((e) => e.path);
  const tracked = entries.filter((e) => e.code !== "??").map((e) => e.path);
  for (const path of untracked) rmSync(join(cwd, path), { force: true, recursive: true });
  if (tracked.length > 0) {
    git(cwd, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
  }
}

export function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export function remoteBranchExists(cwd: string, branch: string): boolean {
  return git(cwd, ["ls-remote", "--heads", "origin", branch]).trim() !== "";
}

export function remoteTagExists(cwd: string, tag: string): boolean {
  return git(cwd, ["ls-remote", "--tags", "origin", tag]).trim() !== "";
}
