import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { FactoryError } from "./exec.ts";
import { LOCK_PATH } from "./paths.ts";
import { approve, cleanup, plan, printStatus } from "./stages.ts";

const USAGE = `使い方: factory/bin/factory <コマンド> [引数]

コマンド:
  plan <チケットID>             tickets/inbox/<ID>.md から仕様の案を作る（人のゲート1の前まで）
  approve <チケットID>          仕様を承認し、テスト作成・実装・PR 作成・レビューまで進める
  status                        利用量、作業ツリー、未マージの PR を表示する
  cleanup <チケットID> [--force]  PR のマージ後に、作業ツリーとローカルのブランチを片付ける
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 同じ作業ツリーや台帳を2つのラインが同時に触らないよう、書き込む操作は1つずつに限る
function withLock(fn: () => void): void {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    if (Number.isInteger(pid) && isAlive(pid)) {
      throw new FactoryError(`別のラインが実行中です（pid ${pid}）`);
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  try {
    fn();
  } finally {
    rmSync(LOCK_PATH, { force: true });
  }
}

function main(args: readonly string[]): number {
  const [command, id, ...rest] = args;
  const config = loadConfig();
  switch (command) {
    case "plan":
      if (!id) break;
      withLock(() => plan(id, config));
      return 0;
    case "approve":
      if (!id) break;
      withLock(() => approve(id, config));
      return 0;
    case "status":
      printStatus(config);
      return 0;
    case "cleanup":
      if (!id) break;
      withLock(() => cleanup(id, rest.includes("--force")));
      return 0;
  }
  process.stderr.write(USAGE);
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`factory: エラー: ${message}`);
  process.exitCode = error instanceof FactoryError ? 1 : 2;
}
