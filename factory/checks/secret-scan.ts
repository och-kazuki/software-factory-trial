import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadDenylist } from "./denylist.ts";
import {
  CONTENT_RULES,
  checkPath,
  type Finding,
  formatFinding,
  isAllowedIdentity,
  linesOf,
  parseAddedLines,
  type Rule,
  scanLines,
} from "./secret-scan-lib.ts";

const USAGE = `Usage: node factory/checks/secret-scan.ts <mode> [--no-denylist]

Modes:
  --tree           Scan every tracked and untracked (not ignored) file
  --staged         Scan lines added in the staged diff
  --range A..B     Scan commits in a range: added lines, messages, author/committer emails
  --history        Scan every commit reachable from any ref
  --pre-push       Scan the commits that a git pre-push hook is about to push (reads stdin)
`;

// 生成物のハッシュ文字列が API キーの形式に偶然一致して誤検出するうえ、中身は npm が整合性を検証するため対象外にする
const SKIP_CONTENT = new Set(["package-lock.json"]);

const ZERO_SHA = /^0+$/;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

function splitNul(output: string): string[] {
  return output.split("\0").filter((s) => s !== "");
}

function buildRules(useDenylist: boolean): Rule[] {
  const rules = [...CONTENT_RULES];
  if (!useDenylist) return rules;
  const denylist = loadDenylist();
  if (denylist.status !== "loaded") {
    const reason = denylist.status === "missing" ? "no denylist at" : "no terms in denylist at";
    console.error(
      `secret-scan: warning: ${reason} ${denylist.path}; organization-specific terms are not checked`,
    );
    return rules;
  }
  rules.push(denylist.rule);
  return rules;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

function scanTree(rules: readonly Rule[]): Finding[] {
  const findings: Finding[] = [];
  const paths = splitNul(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  for (const path of new Set(paths)) {
    const pathFinding = checkPath(path);
    if (pathFinding) findings.push(pathFinding);
    if (SKIP_CONTENT.has(path) || !existsSync(path)) continue;
    const buffer = readFileSync(path);
    if (isBinary(buffer)) continue;
    findings.push(...scanLines(linesOf(buffer.toString("utf8"), path), rules));
  }
  return findings;
}

function withoutSkipped(lines: ReturnType<typeof parseAddedLines>, prefix = "") {
  return lines.filter((line) => {
    const path = line.location.slice(prefix.length).replace(/:\d+$/, "");
    return !SKIP_CONTENT.has(path);
  });
}

function scanStaged(rules: readonly Rule[]): Finding[] {
  const findings: Finding[] = [];
  for (const path of splitNul(
    git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]),
  )) {
    const pathFinding = checkPath(path);
    if (pathFinding) findings.push(pathFinding);
  }
  const diff = git([
    "diff",
    "--cached",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--diff-filter=ACMR",
  ]);
  findings.push(...scanLines(withoutSkipped(parseAddedLines(diff)), rules));
  return findings;
}

function scanCommits(shas: readonly string[], rules: readonly Rule[]): Finding[] {
  const findings: Finding[] = [];
  for (const sha of shas) {
    const short = sha.slice(0, 12);
    const [author = "", committer = "", message = ""] = git([
      "show",
      "-s",
      "--format=%ae%x00%ce%x00%B",
      sha,
    ]).split("\0");
    if (!isAllowedIdentity(author)) {
      findings.push({ rule: "non-noreply-author-email", location: `commit ${short}` });
    }
    if (!isAllowedIdentity(committer)) {
      findings.push({ rule: "non-noreply-committer-email", location: `commit ${short}` });
    }
    findings.push(...scanLines(linesOf(message, `commit ${short} message`), rules));

    // マージコミットは第1親との差分だけを見る。取り込まれた側のコミットは、それぞれ個別に検査される
    const changed = git([
      "show",
      "--format=",
      "--name-only",
      "-z",
      "--diff-merges=first-parent",
      "--diff-filter=ACMR",
      sha,
    ]);
    for (const path of splitNul(changed)) {
      const pathFinding = checkPath(path);
      if (pathFinding) findings.push({ ...pathFinding, location: `commit ${short} ${path}` });
    }
    const diff = git([
      "show",
      "--format=",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--diff-merges=first-parent",
      "--diff-filter=ACMR",
      sha,
    ]);
    const prefix = `commit ${short} `;
    findings.push(...scanLines(withoutSkipped(parseAddedLines(diff, prefix), prefix), rules));
  }
  return findings;
}

function revList(args: readonly string[]): string[] {
  return git(["rev-list", ...args])
    .split("\n")
    .filter((s) => s !== "");
}

function prePushCommits(stdin: string): string[] {
  const shas = new Set<string>();
  for (const line of stdin.split("\n")) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || !remoteSha || ZERO_SHA.test(localSha)) continue;
    const range = ZERO_SHA.test(remoteSha)
      ? [localSha, "--not", "--remotes"]
      : [`${remoteSha}..${localSha}`];
    for (const sha of revList(range)) shas.add(sha);
  }
  return [...shas];
}

function main(argv: readonly string[]): number {
  const useDenylist = !argv.includes("--no-denylist");
  const args = argv.filter((a) => a !== "--no-denylist");
  const [mode, value] = args;

  let findings: Finding[];
  try {
    // git が返すパスはリポジトリのルートからの相対パスなので、どこから実行されても読めるようにする
    process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
    const rules = buildRules(useDenylist);
    switch (mode) {
      case "--tree":
        findings = scanTree(rules);
        break;
      case "--staged":
        findings = scanStaged(rules);
        break;
      case "--range":
        if (!value) {
          process.stderr.write(USAGE);
          return 2;
        }
        findings = scanCommits(revList([value]), rules);
        break;
      case "--history":
        findings = scanCommits(revList(["--all"]), rules);
        break;
      case "--pre-push":
        findings = scanCommits(prePushCommits(readFileSync(0, "utf8")), rules);
        break;
      default:
        process.stderr.write(USAGE);
        return 2;
    }
  } catch (error) {
    console.error(`secret-scan: error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (findings.length === 0) {
    console.log(`secret-scan: ok (${mode})`);
    return 0;
  }
  for (const finding of findings) console.error(formatFinding(finding));
  console.error(
    `secret-scan: ${findings.length} finding(s). Values are intentionally not shown; open each location to inspect it.`,
  );
  return 1;
}

process.exitCode = main(process.argv.slice(2));
