import { execFileSync } from "node:child_process";
import {
  BUILD_STAGE_SCOPE,
  classifyBranch,
  outOfScope,
  specApprovedTag,
  specStageScope,
} from "./diff-scope-lib.ts";

const USAGE = `Usage: node factory/checks/diff-scope.ts --base <sha> --head <sha> --branch <name>

Checks that a factory pull request only touches what each stage may touch:
  merge-base .. spec-approved/<id>   tickets/<id>.md, specs/<id>.md, product/tests/acceptance/
  spec-approved/<id> .. head         product/src/
Branches outside factory/ are skipped.
`;

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function isAncestor(ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles(from: string, to: string): string[] {
  return git(["diff", "--name-only", "-z", from, to])
    .split("\0")
    .filter((s) => s !== "");
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message: string): number {
  console.error(`diff-scope: FAIL: ${message}`);
  return 1;
}

function main(args: readonly string[]): number {
  const base = option(args, "--base");
  const head = option(args, "--head");
  const branch = option(args, "--branch");
  if (!base || !head || branch === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }

  const kind = classifyBranch(branch);
  if (kind.kind === "other") {
    console.log("diff-scope: not a factory branch; skipped");
    return 0;
  }
  if (kind.kind === "invalid-factory") {
    return fail("factory branch name does not contain a valid ticket id");
  }

  const tag = specApprovedTag(kind.id);
  let tagCommit: string;
  try {
    tagCommit = git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
  } catch {
    return fail(`tag ${tag} is missing`);
  }
  const mergeBase = git(["merge-base", base, head]);
  if (!isAncestor(tagCommit, head)) return fail(`${tag} is not an ancestor of the head`);
  if (!isAncestor(mergeBase, tagCommit)) return fail(`${tag} is not based on the target branch`);

  const specViolations = outOfScope(changedFiles(mergeBase, tagCommit), specStageScope(kind.id));
  const buildViolations = outOfScope(changedFiles(tagCommit, head), BUILD_STAGE_SCOPE);
  for (const file of specViolations) console.error(`diff-scope: spec stage touched ${file}`);
  for (const file of buildViolations) console.error(`diff-scope: build stage touched ${file}`);
  if (specViolations.length + buildViolations.length > 0) {
    return fail(`${specViolations.length + buildViolations.length} file(s) out of scope`);
  }
  console.log(`diff-scope: ok (${kind.id})`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`diff-scope: error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
