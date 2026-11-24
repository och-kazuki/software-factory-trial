export const SPEC_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    behavior: { type: "array", items: { type: "string" } },
    acceptance_criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          given: { type: "string" },
          when: { type: "string" },
          outcome: { type: "string" },
        },
        required: ["id", "given", "when", "outcome"],
      },
    },
    out_of_scope: { type: "array", items: { type: "string" } },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "summary",
    "behavior",
    "acceptance_criteria",
    "out_of_scope",
    "open_questions",
  ],
} as const;

export interface SpecDraft {
  readonly title: string;
  readonly summary: string;
  readonly behavior: readonly string[];
  readonly acceptance_criteria: readonly {
    readonly id: string;
    readonly given: string;
    readonly when: string;
    readonly outcome: string;
  }[];
  readonly out_of_scope: readonly string[];
  readonly open_questions: readonly string[];
}

function bullets(items: readonly string[], empty: string): string {
  return items.length === 0 ? `- ${empty}` : items.map((item) => `- ${item}`).join("\n");
}

export function renderSpec(id: string, spec: SpecDraft): string {
  const criteria = spec.acceptance_criteria
    .map((ac) => `### ${ac.id}\n\n- 前提: ${ac.given}\n- 操作: ${ac.when}\n- 結果: ${ac.outcome}`)
    .join("\n\n");
  return `# ${id}: ${spec.title}

## 概要

${spec.summary}

## 振る舞い

${bullets(spec.behavior, "（なし）")}

## 受け入れ条件

${criteria}

## 範囲外

${bullets(spec.out_of_scope, "（なし）")}

## 未解決の質問

${bullets(spec.open_questions, "（なし）")}
`;
}

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["approve", "comment", "request_changes"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          file: { type: "string" },
          line: { type: "integer" },
          message: { type: "string" },
        },
        required: ["severity", "file", "line", "message"],
      },
    },
  },
  required: ["verdict", "summary", "findings"],
} as const;

export interface Review {
  readonly verdict: "approve" | "comment" | "request_changes";
  readonly summary: string;
  readonly findings: readonly {
    readonly severity: "critical" | "major" | "minor";
    readonly file: string;
    readonly line: number;
    readonly message: string;
  }[];
}

const VERDICT_LABEL: Record<Review["verdict"], string> = {
  approve: "問題なし",
  comment: "軽微な指摘あり",
  request_changes: "マージ前に修正が必要",
};

// 表のセルを壊さないよう、改行と縦棒だけは置き換える
function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export function renderReview(review: Review): string {
  const rows =
    review.findings.length === 0
      ? "指摘はありません。"
      : [
          "| 重要度 | 場所 | 内容 |",
          "|---|---|---|",
          ...review.findings.map(
            (f) =>
              `| ${f.severity} | \`${cell(f.file)}${f.line > 0 ? `:${f.line}` : ""}\` | ${cell(f.message)} |`,
          ),
        ].join("\n");
  return `### reviewer（工場の自動レビュー）: ${VERDICT_LABEL[review.verdict]}

${review.summary}

${rows}

<sub>この内容は LLM が書いたものです。マージの判断は人が行ってください。</sub>
`;
}

export function renderPrBody(input: {
  readonly id: string;
  readonly title: string;
  readonly attempts: number;
}): string {
  return `## ${input.id}: ${input.title}

工場（ソフトウェアファクトリー）のラインが作成した PR です。

| 項目 | 内容 |
|---|---|
| 仕様 | \`specs/${input.id}.md\`（人が承認済み） |
| 受け入れテスト | \`product/tests/acceptance/${input.id.toLowerCase()}.test.ts\` |
| 実装の試行回数 | ${input.attempts} |
| ローカルの事前チェック | 型チェック、lint、テスト、秘密情報スキャン、変更範囲：すべて合格 |

### 人が確認すること

- 実装が仕様の受け入れ条件どおりか
- 受け入れテストが仕様を正しく表しているか（テストは仕様の承認後に書かれたもので、まだ人は見ていません）
- reviewer のコメント

🤖 Generated with [Claude Code](https://claude.com/claude-code)
`;
}
