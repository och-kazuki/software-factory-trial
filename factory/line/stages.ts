import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILD_STAGE_SCOPE, outOfScope, specApprovedTag } from "../checks/diff-scope-lib.ts";
import type { Rule } from "../checks/secret-scan-lib.ts";
import { runRole, scrubbedEnv } from "./claude.ts";
import type { FactoryConfig, Role } from "./config.ts";
import {
  REVIEW_SCHEMA,
  type Review,
  renderPrBody,
  renderReview,
  renderSpec,
  SPEC_SCHEMA,
  type SpecDraft,
} from "./documents.ts";
import { exec, execOk, FactoryError, tail } from "./exec.ts";
import {
  git,
  refExists,
  remoteBranchExists,
  remoteTagExists,
  revert,
  type StatusEntry,
  status,
} from "./git.ts";
import { localDay, readLedger, spentOnDay, spentOnTicket } from "./ledger.ts";
import { prepareOutgoing, requireDenylistRule, sanitize } from "./outgoing.ts";
import {
  acceptanceTestPathInRepo,
  branchOf,
  CHECKS_DIR,
  ROOT,
  runDirOf,
  specPathInRepo,
  ticketPathInRepo,
  WORKTREES_DIR,
  worktreeOf,
} from "./paths.ts";
import { loadTicket, type Ticket } from "./tickets.ts";

function log(message: string): void {
  console.log(`factory: ${message}`);
}

function writeInTree(worktree: string, path: string, content: string): void {
  const full = join(worktree, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function describe(entries: readonly StatusEntry[]): string {
  return entries.map((e) => e.path).join(", ");
}

// 上限は CLI の --max-budget-usd だけに頼らず、台帳の合計でも工程を始める前に確かめる
export function ensureBudget(config: FactoryConfig, ticket: string, role: Role): void {
  const caps = config.usageCapsUsdEquivalent;
  const entries = readLedger();
  const next = caps[role];
  const ticketSpent = spentOnTicket(entries, ticket);
  const daySpent = spentOnDay(entries, localDay(new Date()));
  if (ticketSpent + next > caps.perTicket) {
    throw new FactoryError(
      `チケット ${ticket} の利用量が上限に達するため止めました（使用済み $${ticketSpent.toFixed(2)} 相当 + 次の工程の上限 $${next} > チケットの上限 $${caps.perTicket}）`,
    );
  }
  if (daySpent + next > caps.perDay) {
    throw new FactoryError(
      `今日の利用量が上限に達するため止めました（使用済み $${daySpent.toFixed(2)} 相当 + 次の工程の上限 $${next} > 1日の上限 $${caps.perDay}）`,
    );
  }
}

interface OpenPr {
  readonly headRefName: string;
  readonly url: string;
}

function openFactoryPrs(): OpenPr[] {
  const out = execOk("gh", ["pr", "list", "--state", "open", "--json", "headRefName,url"], {
    cwd: ROOT,
  });
  return (JSON.parse(out) as OpenPr[]).filter((pr) => pr.headRefName.startsWith("factory/"));
}

function runChecks(worktree: string, scripts: readonly ("typecheck" | "lint" | "test")[]): string {
  for (const script of scripts) {
    const args = script === "test" ? ["test"] : ["run", script];
    const result = exec("npm", args, { cwd: worktree, env: scrubbedEnv() });
    if (result.code !== 0) {
      return `npm ${args.join(" ")} が失敗しました:\n${sanitize(tail(`${result.stdout}\n${result.stderr}`))}`;
    }
  }
  return "";
}

function scanStaged(worktree: string): string {
  const result = exec("node", [join(CHECKS_DIR, "secret-scan.ts"), "--staged"], {
    cwd: worktree,
  });
  if (result.code === 0) return "";
  const findings = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("secret-scan: ["))
    .join("\n");
  return `秘密情報スキャンで検出がありました（値は表示しません）:\n${findings}`;
}

function listProductTests(worktree: string): string[] {
  const base = join(worktree, "product", "tests");
  return readdirSync(base, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith(".test.ts"))
    .map((p) => `product/tests/${p}`)
    .sort();
}

function isSpecDraft(value: unknown): value is SpecDraft {
  const v = value as SpecDraft | undefined;
  return (
    typeof v?.title === "string" &&
    typeof v.summary === "string" &&
    Array.isArray(v.behavior) &&
    Array.isArray(v.acceptance_criteria) &&
    v.acceptance_criteria.length > 0 &&
    Array.isArray(v.out_of_scope) &&
    Array.isArray(v.open_questions)
  );
}

function isReview(value: unknown): value is Review {
  const v = value as Review | undefined;
  return (
    (v?.verdict === "approve" || v?.verdict === "comment" || v?.verdict === "request_changes") &&
    typeof v.summary === "string" &&
    Array.isArray(v.findings)
  );
}

function plannerPrompt(ticket: Ticket): string {
  return `チケット ${ticket.id} の仕様を作成してください。

# チケット

${ticket.text}

# 参考にするもの

- 題材プロダクトの説明と設計ルール: product/CLAUDE.md
- 既存の実装: product/src/
- 既存の受け入れテスト: product/tests/acceptance/

受け入れ条件の ID は AC1, AC2, ... の形式にしてください。`;
}

function testWriterPrompt(id: string, spec: string, testPath: string, symptoms: string): string {
  const retry = symptoms === "" ? "" : `\n# 前回の指摘（これを解消すること）\n\n${symptoms}\n`;
  return `チケット ${id} の受け入れテストを書いてください。

# 承認済みの仕様

${spec}

# 作成するファイル

${testPath}（このファイルだけを作成する）
${retry}`;
}

function builderPrompt(id: string, spec: string, testPath: string, symptoms: string): string {
  const retry =
    symptoms === "" ? "" : `\n# 前回の不合格の症状（この原因を直すこと）\n\n${symptoms}\n`;
  return `チケット ${id} を実装してください。

# 承認済みの仕様

${spec}

# 合格させる受け入れテスト

${testPath}（変更してはいけない）
${retry}`;
}

function reviewerPrompt(id: string, spec: string, diff: string): string {
  return `チケット ${id} の PR をレビューしてください。

# 承認済みの仕様

${spec}

# 差分（main との比較）

\`\`\`diff
${diff}
\`\`\`

# ローカルの事前チェック

型チェック、lint、テスト、秘密情報スキャン、変更範囲のチェックは、すべて合格しています。`;
}

export function plan(id: string, config: FactoryConfig): void {
  requireDenylistRule();
  const ticket = loadTicket(id);
  const open = openFactoryPrs();
  if (open.length > 0) {
    throw new FactoryError(
      `マージされていない工場の PR があります: ${open.map((p) => p.url).join(", ")}\n` +
        "チケットは前の結果の上に積み重なるため、マージしてから次のチケットを始めてください",
    );
  }
  const worktree = worktreeOf(id);
  if (existsSync(worktree)) {
    throw new FactoryError(
      `作業ツリーがすでにあります（${worktree}）。続けるなら approve、やり直すなら cleanup を使ってください`,
    );
  }
  git(ROOT, ["fetch", "--quiet", "origin", "main"]);
  const branch = branchOf(id);
  const tag = specApprovedTag(id);
  if (
    refExists(ROOT, `refs/heads/${branch}`) ||
    remoteBranchExists(ROOT, branch) ||
    remoteTagExists(ROOT, tag)
  ) {
    throw new FactoryError(`${branch} か ${tag} がすでに存在します`);
  }
  ensureBudget(config, id, "planner");

  mkdirSync(WORKTREES_DIR, { recursive: true });
  git(ROOT, ["worktree", "add", "--quiet", "-b", branch, worktree, "origin/main"]);
  writeInTree(worktree, ticketPathInRepo(id), ticket.text);

  log(`planner を実行しています（${config.models.planner}）`);
  const result = runRole(
    {
      ticket: id,
      stage: "planner",
      role: "planner",
      cwd: worktree,
      prompt: plannerPrompt(ticket),
      schema: SPEC_SCHEMA,
    },
    config,
  );
  if (!result.ok || !isSpecDraft(result.structured)) {
    throw new FactoryError(
      `planner が失敗しました（${result.subtype}）。作業ツリーは ${worktree} に残っています`,
    );
  }
  const spec = result.structured;
  writeInTree(worktree, specPathInRepo(id), renderSpec(id, spec));
  log(`仕様の案を書きました: ${join(worktree, specPathInRepo(id))}`);
  if (spec.open_questions.length > 0) {
    log(
      `未解決の質問が ${spec.open_questions.length} 件あります。仕様を編集して答えを書き込んでから承認してください`,
    );
  }
  log(`確認・編集が済んだら、次のコマンドで承認します: factory/bin/factory approve ${id}`);
}

function writeAcceptanceTests(
  id: string,
  worktree: string,
  spec: string,
  config: FactoryConfig,
): void {
  const testPath = acceptanceTestPathInRepo(id);
  const allowed = new Set([ticketPathInRepo(id), specPathInRepo(id), testPath]);
  let symptoms = "";
  for (let attempt = 1; attempt <= config.maxTestWriterAttempts; attempt++) {
    ensureBudget(config, id, "testWriter");
    log(`test-writer を実行しています（${attempt} 回目）`);
    const result = runRole(
      {
        ticket: id,
        stage: `test-writer-${attempt}`,
        role: "testWriter",
        cwd: worktree,
        prompt: testWriterPrompt(id, spec, testPath, symptoms),
      },
      config,
    );
    const outside = status(worktree).filter((e) => !allowed.has(e.path));
    if (outside.length > 0) {
      revert(worktree, outside);
      symptoms = `書いてよいのは ${testPath} だけです。次の変更は元に戻しました: ${describe(outside)}`;
      continue;
    }
    if (!result.ok) {
      symptoms = `前回の実行が途中で止まりました（${result.subtype}）`;
      continue;
    }
    if (!existsSync(join(worktree, testPath))) {
      symptoms = `${testPath} が作成されていません`;
      continue;
    }
    const quality = runChecks(worktree, ["typecheck", "lint"]);
    if (quality !== "") {
      symptoms = quality;
      continue;
    }
    const others = listProductTests(worktree).filter((p) => p !== testPath);
    const existing = exec("node", ["--test", ...others], { cwd: worktree, env: scrubbedEnv() });
    if (existing.code !== 0) {
      symptoms = `既存のテストが失敗するようになりました:\n${sanitize(tail(existing.stdout))}`;
      continue;
    }
    // 実装の前から通るテストは、何も確かめていないのと同じなので先へ進めない
    const red = exec("node", ["--test", testPath], { cwd: worktree, env: scrubbedEnv() });
    if (red.code === 0) {
      throw new FactoryError(
        `受け入れテストが実装の前から通ってしまいます。仕様かテストを見直してください: ${join(worktree, testPath)}`,
      );
    }
    log("受け入れテストが実装の前に失敗することを確認しました（red）");
    return;
  }
  throw new FactoryError(
    `test-writer が ${config.maxTestWriterAttempts} 回で条件を満たせませんでした。最後の症状:\n${symptoms}`,
  );
}

function commitExactly(worktree: string, paths: readonly string[], message: string): void {
  git(worktree, ["add", "--", ...paths]);
  const leftovers = status(worktree).filter((e) => !paths.includes(e.path) || e.code[1] !== " ");
  if (leftovers.length > 0) {
    throw new FactoryError(`コミットの対象外の変更が残っています: ${describe(leftovers)}`);
  }
  const scan = scanStaged(worktree);
  if (scan !== "") throw new FactoryError(scan);
  git(worktree, ["commit", "--quiet", "--no-verify", "-m", message]);
}

function build(
  id: string,
  ticket: Ticket,
  worktree: string,
  spec: string,
  config: FactoryConfig,
): number {
  const testPath = acceptanceTestPathInRepo(id);
  let symptoms = "";
  for (let attempt = 1; attempt <= config.maxBuildAttempts; attempt++) {
    ensureBudget(config, id, "builder");
    log(`builder を実行しています（${attempt} 回目）`);
    const result = runRole(
      {
        ticket: id,
        stage: `builder-${attempt}`,
        role: "builder",
        cwd: worktree,
        prompt: builderPrompt(id, spec, testPath, symptoms),
      },
      config,
    );
    const outside = status(worktree).filter(
      (e) => outOfScope([e.path], BUILD_STAGE_SCOPE).length > 0,
    );
    if (outside.length > 0) {
      revert(worktree, outside);
      symptoms = `product/src/ 以外は変更できません。次の変更は元に戻しました: ${describe(outside)}`;
      continue;
    }
    if (!result.ok) {
      symptoms = `前回の実行が途中で止まりました（${result.subtype}）。product/src/ の変更は残してあります`;
      continue;
    }
    if (status(worktree).length === 0) {
      symptoms = "product/src/ に変更がありません";
      continue;
    }
    const failure = runChecks(worktree, ["typecheck", "lint", "test"]);
    if (failure !== "") {
      symptoms = failure;
      continue;
    }
    git(worktree, ["add", "-A", "--", "product/src"]);
    const scan = scanStaged(worktree);
    if (scan !== "") {
      git(worktree, ["reset", "--quiet"]);
      symptoms = scan;
      continue;
    }
    const leftovers = status(worktree).filter((e) => e.code[1] !== " ");
    if (leftovers.length > 0) {
      throw new FactoryError(`コミットの対象外の変更が残っています: ${describe(leftovers)}`);
    }
    git(worktree, ["commit", "--quiet", "--no-verify", "-m", `${id}: ${ticket.title} を実装`]);
    log(`実装をコミットしました（${attempt} 回目で合格）`);
    return attempt;
  }
  throw new FactoryError(
    `builder が ${config.maxBuildAttempts} 回で合格しませんでした。作業ツリーは ${worktree} に残っています。最後の症状:\n${symptoms}`,
  );
}

function publish(
  id: string,
  ticket: Ticket,
  worktree: string,
  attempts: number,
  denylist: Rule,
): string {
  git(ROOT, ["fetch", "--quiet", "origin", "main"]);
  const scan = exec("node", [join(CHECKS_DIR, "secret-scan.ts"), "--range", "origin/main..HEAD"], {
    cwd: worktree,
  });
  if (scan.code !== 0) {
    throw new FactoryError(`push 前の秘密情報スキャンで検出がありました:\n${scan.stderr}`);
  }
  const tag = specApprovedTag(id);
  const branch = branchOf(id);
  // 検査は本体側のスキャナーで済ませた。作業ツリー側のフックは LLM が触れうるため実行しない
  git(worktree, ["push", "--quiet", "--no-verify", "origin", `refs/tags/${tag}`]);
  git(worktree, ["push", "--quiet", "--no-verify", "-u", "origin", branch]);
  const title = prepareOutgoing(`${id}: ${ticket.title}`, denylist);
  const body = prepareOutgoing(renderPrBody({ id, title: ticket.title, attempts }), denylist);
  const url = execOk(
    "gh",
    ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body-file", "-"],
    { cwd: ROOT, input: body },
  ).trim();
  log(`PR を作成しました: ${url}`);
  return url;
}

function review(
  id: string,
  worktree: string,
  spec: string,
  url: string,
  config: FactoryConfig,
  denylist: Rule,
): void {
  try {
    ensureBudget(config, id, "reviewer");
  } catch (error) {
    log(`reviewer は省略しました: ${(error as Error).message}`);
    return;
  }
  log("reviewer を実行しています");
  const diff = git(worktree, ["diff", "origin/main...HEAD"]);
  const result = runRole(
    {
      ticket: id,
      stage: "reviewer",
      role: "reviewer",
      cwd: worktree,
      prompt: reviewerPrompt(id, spec, diff),
      schema: REVIEW_SCHEMA,
    },
    config,
  );
  if (!result.ok || !isReview(result.structured)) {
    log(`reviewer が失敗しました（${result.subtype}）。PR へのコメントは省略します`);
    return;
  }
  const comment = renderReview(result.structured);
  let body: string;
  try {
    body = prepareOutgoing(comment, denylist);
  } catch (error) {
    const path = join(runDirOf(id), "review-blocked.md");
    writeFileSync(path, comment);
    log(`${(error as Error).message}。レビュー結果はローカルに保存しました: ${path}`);
    return;
  }
  execOk("gh", ["pr", "comment", url, "--body-file", "-"], { cwd: ROOT, input: body });
  log(`reviewer の結果を PR にコメントしました（${result.structured.verdict}）`);
}

export function approve(id: string, config: FactoryConfig): void {
  const denylist = requireDenylistRule();
  const ticket = loadTicket(id);
  const worktree = worktreeOf(id);
  if (!existsSync(worktree)) throw new FactoryError(`先に factory plan ${id} を実行してください`);
  const tag = specApprovedTag(id);
  if (refExists(worktree, `refs/tags/${tag}`)) throw new FactoryError(`${id} は承認済みです`);
  const ticketPath = ticketPathInRepo(id);
  const specPath = specPathInRepo(id);
  if (!existsSync(join(worktree, specPath))) {
    throw new FactoryError(`仕様がありません: ${join(worktree, specPath)}`);
  }
  const unexpected = status(worktree).filter((e) => e.path !== specPath && e.path !== ticketPath);
  if (unexpected.length > 0) {
    throw new FactoryError(`仕様とチケット以外に変更があります: ${describe(unexpected)}`);
  }
  const spec = readFileSync(join(worktree, specPath), "utf8");

  writeAcceptanceTests(id, worktree, spec, config);
  commitExactly(
    worktree,
    [ticketPath, specPath, acceptanceTestPathInRepo(id)],
    `${id}: 仕様と受け入れテストを追加`,
  );
  git(worktree, ["tag", tag]);
  log(`仕様と受け入れテストをコミットし、${tag} タグを付けました`);

  const attempts = build(id, ticket, worktree, spec, config);
  const url = publish(id, ticket, worktree, attempts, denylist);
  review(id, worktree, spec, url, config, denylist);
  log(`完了しました。PR を確認してマージしてください: ${url}`);
  log(`マージした後は factory/bin/factory cleanup ${id} で作業ツリーを片付けます`);
}

export function printStatus(config: FactoryConfig): void {
  const entries = readLedger();
  const caps = config.usageCapsUsdEquivalent;
  const today = localDay(new Date());
  console.log(
    `今日の利用量: $${spentOnDay(entries, today).toFixed(2)} 相当 / 上限 $${caps.perDay}（金額は API 料金に換算した参考値）`,
  );
  const tickets = [...new Set(entries.map((e) => e.ticket))].sort();
  for (const ticket of tickets) {
    const own = entries.filter((e) => e.ticket === ticket);
    const tokens = own.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
    console.log(
      `  ${ticket}: $${spentOnTicket(entries, ticket).toFixed(2)} 相当 / 上限 $${caps.perTicket}、工程 ${own.length} 回、入出力トークン ${tokens}`,
    );
  }
  const worktrees = existsSync(WORKTREES_DIR) ? readdirSync(WORKTREES_DIR) : [];
  console.log(`作業ツリー: ${worktrees.length === 0 ? "なし" : worktrees.join(", ")}`);
  const open = openFactoryPrs();
  console.log(
    `未マージの工場の PR: ${open.length === 0 ? "なし" : open.map((p) => p.url).join(", ")}`,
  );
}

export function cleanup(id: string, force: boolean): void {
  const branch = branchOf(id);
  const view = exec("gh", ["pr", "view", branch, "--json", "state", "--jq", ".state"], {
    cwd: ROOT,
  });
  const state = view.code === 0 ? view.stdout.trim() : "NONE";
  if (state === "OPEN" && !force) {
    throw new FactoryError(
      `${branch} の PR はまだ開いています。片付けるなら --force を付けてください`,
    );
  }
  const worktree = worktreeOf(id);
  if (existsSync(worktree)) git(ROOT, ["worktree", "remove", "--force", worktree]);
  if (refExists(ROOT, `refs/heads/${branch}`)) git(ROOT, ["branch", "-D", branch]);
  const tag = specApprovedTag(id);
  if (refExists(ROOT, `refs/tags/${tag}`)) git(ROOT, ["tag", "-d", tag]);
  log(`${id} の作業ツリーとローカルのブランチを片付けました（PR の状態: ${state}）`);
}
