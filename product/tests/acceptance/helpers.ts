import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// 受け入れテストは利用者と同じ経路で確かめたいので、関数を直接呼ばずに別プロセスとして起動する
export function runCli(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): CliRun {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

// CLI はカレントディレクトリのファイルを読み書きするため、テストごとに使い捨てのディレクトリで動かす
export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "mdtask-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
