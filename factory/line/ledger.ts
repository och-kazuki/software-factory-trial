import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { LEDGER_PATH } from "./paths.ts";

export interface LedgerEntry {
  readonly ts: string;
  readonly ticket: string;
  readonly stage: string;
  readonly model: string;
  readonly subtype: string;
  readonly costUsdEquivalent: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly durationMs: number;
  readonly turns: number;
  readonly permissionDenials: number;
}

export function appendLedger(entry: LedgerEntry, path = LEDGER_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function parseLedger(text: string): LedgerEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LedgerEntry);
}

export function readLedger(path = LEDGER_PATH): LedgerEntry[] {
  return existsSync(path) ? parseLedger(readFileSync(path, "utf8")) : [];
}

// 日付の区切りは利用者の感覚に合わせ、UTC ではなく実行環境のローカル時刻で取る
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function spentOnTicket(entries: readonly LedgerEntry[], ticket: string): number {
  return entries
    .filter((e) => e.ticket === ticket)
    .reduce((sum, e) => sum + e.costUsdEquivalent, 0);
}

export function spentOnDay(entries: readonly LedgerEntry[], day: string): number {
  return entries
    .filter((e) => localDay(new Date(e.ts)) === day)
    .reduce((sum, e) => sum + e.costUsdEquivalent, 0);
}
