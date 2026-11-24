import { homedir } from "node:os";
import { loadDenylist } from "../checks/denylist.ts";
import {
  CONTENT_RULES,
  type Finding,
  isAllowedEmail,
  linesOf,
  type Rule,
  scanLines,
} from "../checks/secret-scan-lib.ts";
import { FactoryError } from "./exec.ts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// LLM の出力にはツールの実行結果がそのまま混ざることがあるため、公開前に機械的に伏せる
export function sanitize(text: string, home = homedir()): string {
  let out = text;
  if (home !== "" && home !== "/") out = out.replace(new RegExp(escapeRegExp(home), "g"), "~");
  out = out.replace(/(?:\/home|\/Users)\/[A-Za-z0-9._-]+/g, "~");
  return out.replace(EMAIL, (m) => (isAllowedEmail(m) ? m : "<email>"));
}

export function requireDenylistRule(): Rule {
  const denylist = loadDenylist();
  if (denylist.status !== "loaded") {
    throw new FactoryError(
      `禁止語リスト（${denylist.path}）が${denylist.status === "missing" ? "ありません" : "空です"}。` +
        "工場は公開リポジトリに書き込むため、会社名などの禁止語を登録してから実行してください。",
    );
  }
  return denylist.rule;
}

export function scanOutgoing(text: string, rules: readonly Rule[]): Finding[] {
  return scanLines(linesOf(text, "outgoing"), rules);
}

// 伏せた後でも検出が残る文章は、公開せずに止める
export function prepareOutgoing(text: string, denylist: Rule): string {
  const sanitized = sanitize(text);
  const findings = scanOutgoing(sanitized, [...CONTENT_RULES, denylist]);
  if (findings.length > 0) {
    const rules = [...new Set(findings.map((f) => f.rule))].join(", ");
    throw new FactoryError(
      `公開しようとした文章に検出が残っているため、送信を止めました: ${rules}`,
    );
  }
  return sanitized;
}
