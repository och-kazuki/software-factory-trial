export interface Scope {
  readonly exact: readonly string[];
  readonly prefixes: readonly string[];
}

export type BranchKind =
  | { readonly kind: "other" }
  | { readonly kind: "factory"; readonly id: string }
  | { readonly kind: "invalid-factory" };

export const TICKET_ID = /^T-\d{3}$/;
export const FACTORY_BRANCH_PREFIX = "factory/";

export function specApprovedTag(id: string): string {
  return `spec-approved/${id}`;
}

export function classifyBranch(branch: string): BranchKind {
  if (!branch.startsWith(FACTORY_BRANCH_PREFIX)) return { kind: "other" };
  const id = branch.slice(FACTORY_BRANCH_PREFIX.length);
  // 工場のブランチなのに ID が読めない場合は、検査を素通りさせないよう不合格側に倒す
  return TICKET_ID.test(id) ? { kind: "factory", id } : { kind: "invalid-factory" };
}

// 仕様の承認時点までに入ってよいのは、チケット・仕様・受け入れテストだけ
export function specStageScope(id: string): Scope {
  return {
    exact: [`tickets/${id}.md`, `specs/${id}.md`],
    prefixes: ["product/tests/acceptance/"],
  };
}

// 承認後に builder が触ってよいのは実装だけ。テストや設定を変えて合格をすり抜けるのを防ぐ
export const BUILD_STAGE_SCOPE: Scope = { exact: [], prefixes: ["product/src/"] };

export function outOfScope(files: readonly string[], scope: Scope): string[] {
  return files.filter(
    (file) => !scope.exact.includes(file) && !scope.prefixes.some((p) => file.startsWith(p)),
  );
}
