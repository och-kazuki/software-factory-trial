import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FactoryConfig, Role } from "./config.ts";
import { exec } from "./exec.ts";
import { appendLedger } from "./ledger.ts";
import { ROLES_DIR, runDirOf } from "./paths.ts";

export interface RoleDefinition {
  readonly tools: readonly string[];
  readonly restricted: boolean;
  readonly permissions: { readonly allow: readonly string[]; readonly deny: readonly string[] };
}

export interface RoleRun {
  readonly ticket: string;
  readonly stage: string;
  readonly role: Role;
  readonly cwd: string;
  readonly prompt: string;
  readonly schema?: object;
  // プローブで権限設定だけを確かめるときに、役割の指示（「テストは変更しない」など）を外すために使う
  readonly systemPromptOverride?: string;
}

export interface RoleResult {
  readonly ok: boolean;
  readonly subtype: string;
  readonly text: string;
  readonly structured: unknown;
  readonly costUsdEquivalent: number;
  readonly permissionDenials: readonly unknown[];
}

const ROLE_DIRS: Record<Role, string> = {
  planner: "planner",
  testWriter: "test-writer",
  builder: "builder",
  reviewer: "reviewer",
};

// LLM の工程が実行するコード（builder の書いたテストなど）から使われないよう、
// 外部へ書き込める認証情報を環境変数から外す。ファイルに置かれた認証情報までは防げない（Phase 4 で隔離する）
const SCRUBBED_ENV = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "SSH_AUTH_SOCK",
  "SSH_ASKPASS",
  "GIT_ASKPASS",
  "NPM_TOKEN",
];

export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of SCRUBBED_ENV) delete copy[key];
  return copy;
}

export function loadRole(role: Role): { definition: RoleDefinition; prompt: string } {
  const dir = join(ROLES_DIR, ROLE_DIRS[role]);
  return {
    definition: JSON.parse(readFileSync(join(dir, "role.json"), "utf8")) as RoleDefinition,
    prompt: readFileSync(join(dir, "prompt.md"), "utf8"),
  };
}

export function buildSettings(definition: RoleDefinition, home = homedir()): string {
  return JSON.stringify({
    // リポジトリがホームの下にあると、利用者の CLAUDE.md がプロジェクトの指示として読み込まれてしまうため除外する
    claudeMdExcludes: [join(home, ".claude", "CLAUDE.md")],
    permissions: { allow: definition.permissions.allow, deny: definition.permissions.deny },
  });
}

export function buildArgs(
  definition: RoleDefinition,
  systemPrompt: string,
  model: string,
  budget: number,
  schema?: object,
): string[] {
  const args = [
    "-p",
    "--setting-sources",
    "project",
    "--settings",
    buildSettings(definition),
    "--tools",
    definition.tools.join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--model",
    model,
    "--max-budget-usd",
    String(budget),
    "--no-session-persistence",
    "--output-format",
    "json",
    "--append-system-prompt",
    systemPrompt,
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  if (definition.restricted) args.push("--restricted");
  return args;
}

interface ClaudeJson {
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  permission_denials?: unknown[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function runRole(run: RoleRun, config: FactoryConfig): RoleResult {
  const { definition, prompt: rolePrompt } = loadRole(run.role);
  const model = config.models[run.role];
  const budget = config.usageCapsUsdEquivalent[run.role];
  const systemPrompt = run.systemPromptOverride ?? rolePrompt;
  const args = buildArgs(definition, systemPrompt, model, budget, run.schema);
  // プロンプトが長くなってもコマンドラインの長さ制限に当たらないよう、標準入力で渡す
  const result = exec("claude", args, { cwd: run.cwd, env: scrubbedEnv(), input: run.prompt });

  const runDir = runDirOf(run.ticket);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, `${run.stage}.json`), result.stdout);
  if (result.stderr.trim() !== "")
    writeFileSync(join(runDir, `${run.stage}.stderr`), result.stderr);

  let parsed: ClaudeJson = {};
  try {
    parsed = JSON.parse(result.stdout) as ClaudeJson;
  } catch {
    parsed = { subtype: "invalid_output", is_error: true };
  }
  const usage = parsed.usage ?? {};
  const costUsdEquivalent = parsed.total_cost_usd ?? 0;
  const permissionDenials = parsed.permission_denials ?? [];
  appendLedger({
    ts: new Date().toISOString(),
    ticket: run.ticket,
    stage: run.stage,
    model,
    subtype: parsed.subtype ?? "unknown",
    costUsdEquivalent,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    durationMs: parsed.duration_ms ?? 0,
    turns: parsed.num_turns ?? 0,
    permissionDenials: permissionDenials.length,
  });

  return {
    ok: result.code === 0 && parsed.is_error !== true && parsed.subtype === "success",
    subtype: parsed.subtype ?? "unknown",
    text: typeof parsed.result === "string" ? parsed.result : "",
    structured: parsed.structured_output,
    costUsdEquivalent,
    permissionDenials,
  };
}
