export interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly allow?: (match: string) => boolean;
}

export interface Finding {
  readonly rule: string;
  readonly location: string;
}

export interface Line {
  readonly location: string;
  readonly text: string;
}

const ALLOWED_EMAILS = new Set(["git@github.com", "noreply@github.com"]);
const ALLOWED_EMAIL_SUFFIXES = [
  "@users.noreply.github.com",
  "@example.com",
  "@example.org",
  "@example.net",
];

export function isAllowedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return ALLOWED_EMAILS.has(lower) || ALLOWED_EMAIL_SUFFIXES.some((s) => lower.endsWith(s));
}

// GitHub のウェブ画面でマージすると committer が noreply@github.com になるため、それだけは個人のアドレスと区別して許可する
export function isAllowedIdentity(email: string): boolean {
  const lower = email.toLowerCase();
  return lower.endsWith("@users.noreply.github.com") || lower === "noreply@github.com";
}

export const CONTENT_RULES: readonly Rule[] = [
  { id: "anthropic-api-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "openai-api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { id: "github-fine-grained-token", pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { id: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: "slack-token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: "credential-assignment",
    pattern: /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b\s*[:=]\s*["'][^"'\s]{12,}["']/gi,
  },
  {
    id: "email-address",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allow: isAllowedEmail,
  },
  // 実行ログや LLM の出力に紛れ込みやすく、ユーザー名がそのまま公開されてしまうため検出する
  {
    id: "home-directory-path",
    pattern: /(?:\/home\/|\/Users\/|\b[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+/g,
  },
];

const FORBIDDEN_BASENAMES: readonly RegExp[] = [
  /^\.env(?:\..+)?$/,
  /\.(?:pem|key|p12|pfx)$/,
  /^id_(?:rsa|ed25519|ecdsa)$/,
  /^\.?credentials\.json$/,
  /^hosts\.yml$/,
];

export function checkPath(path: string): Finding | null {
  const base = path.split("/").pop() ?? path;
  if (base === ".env.example") return null;
  return FORBIDDEN_BASENAMES.some((re) => re.test(base))
    ? { rule: "forbidden-file", location: path }
    : null;
}

export function parseDenylist(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export function denylistRule(terms: readonly string[]): Rule | null {
  if (terms.length === 0) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return { id: "denylisted-term", pattern: new RegExp(escaped.join("|"), "gi") };
}

export function linesOf(text: string, path: string): Line[] {
  return text.split("\n").map((t, i) => ({ location: `${path}:${i + 1}`, text: t }));
}

export function scanLines(lines: Iterable<Line>, rules: readonly Rule[]): Finding[] {
  const findings: Finding[] = [];
  for (const { location, text } of lines) {
    for (const rule of rules) {
      for (const match of text.matchAll(rule.pattern)) {
        if (rule.allow?.(match[0])) continue;
        // 場所さえ分かれば人が確認できるので、同じ行・同じルールは1件にまとめる
        findings.push({ rule: rule.id, location });
        break;
      }
    }
  }
  return findings;
}

// `git diff -U0` の出力から、追加された行だけを新しいファイル側の行番号つきで取り出す
export function parseAddedLines(diff: string, prefix = ""): Line[] {
  const lines: Line[] = [];
  let path = "";
  let next = 0;
  // 追加行の中身が "++" で始まると "+++ " と区別できないため、ファイルヘッダーの中にいる間だけヘッダーとして扱う
  let inHeader = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHeader = true;
      path = "";
      continue;
    }
    if (inHeader && raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      path = target === "/dev/null" ? "" : target.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("@@")) {
      inHeader = false;
      const m = /\+(\d+)/.exec(raw);
      next = m ? Number(m[1]) : 0;
      continue;
    }
    if (!inHeader && path !== "" && raw.startsWith("+")) {
      lines.push({ location: `${prefix}${path}:${next}`, text: raw.slice(1) });
      next += 1;
    }
  }
  return lines;
}

// 公開リポジトリの CI ログは誰でも読めるため、見つかった値そのものは決して出力しない
export function formatFinding(finding: Finding): string {
  return `secret-scan: [${finding.rule}] ${finding.location}`;
}
