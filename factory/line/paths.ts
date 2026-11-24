import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 工程の作業ツリーにも工場のコードのコピーがあるが、そちらは LLM が書き換えられる。
// 検査やコミットの判断には、必ずこのファイルがある本体側の checkout を使う
export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const FACTORY_DIR = join(ROOT, "factory");
export const ROLES_DIR = join(FACTORY_DIR, "roles");
export const CHECKS_DIR = join(FACTORY_DIR, "checks");
export const RUNS_DIR = join(ROOT, "runs");
export const LEDGER_PATH = join(RUNS_DIR, "ledger.jsonl");
export const LOCK_PATH = join(RUNS_DIR, "factory.lock");
export const WORKTREES_DIR = join(ROOT, ".worktrees");
export const INBOX_DIR = join(ROOT, "tickets", "inbox");

export function worktreeOf(id: string): string {
  return join(WORKTREES_DIR, id);
}

export function branchOf(id: string): string {
  return `factory/${id}`;
}

export function ticketPathInRepo(id: string): string {
  return `tickets/${id}.md`;
}

export function specPathInRepo(id: string): string {
  return `specs/${id}.md`;
}

export function acceptanceTestPathInRepo(id: string): string {
  return `product/tests/acceptance/${id.toLowerCase()}.test.ts`;
}

export function runDirOf(id: string): string {
  return join(RUNS_DIR, id);
}
