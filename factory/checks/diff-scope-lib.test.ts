import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BUILD_STAGE_SCOPE,
  classifyBranch,
  outOfScope,
  specApprovedTag,
  specStageScope,
} from "./diff-scope-lib.ts";

describe("classifyBranch", () => {
  test("ignores branches outside factory/", () => {
    assert.deepEqual(classifyBranch("feat/phase1-line"), { kind: "other" });
  });

  test("extracts the ticket id from a factory branch", () => {
    assert.deepEqual(classifyBranch("factory/T-001"), { kind: "factory", id: "T-001" });
  });

  test("rejects factory branches without a valid ticket id", () => {
    for (const branch of ["factory/", "factory/T-1", "factory/T-001-extra", "factory/../main"]) {
      assert.deepEqual(classifyBranch(branch), { kind: "invalid-factory" }, branch);
    }
  });
});

describe("scopes", () => {
  test("spec stage allows only the ticket, its spec and acceptance tests", () => {
    const files = [
      "tickets/T-001.md",
      "specs/T-001.md",
      "product/tests/acceptance/t-001.test.ts",
      "specs/T-002.md",
      "product/src/cli.ts",
      "package.json",
    ];
    assert.deepEqual(outOfScope(files, specStageScope("T-001")), [
      "specs/T-002.md",
      "product/src/cli.ts",
      "package.json",
    ]);
  });

  test("build stage allows only product/src", () => {
    const files = [
      "product/src/cli.ts",
      "product/src/tasks/store.ts",
      "product/tests/acceptance/t-001.test.ts",
      "factory/checks/diff-scope.ts",
      ".github/workflows/ci.yml",
      "product/srcx/evil.ts",
    ];
    assert.deepEqual(outOfScope(files, BUILD_STAGE_SCOPE), [
      "product/tests/acceptance/t-001.test.ts",
      "factory/checks/diff-scope.ts",
      ".github/workflows/ci.yml",
      "product/srcx/evil.ts",
    ]);
  });

  test("tag name follows the ticket id", () => {
    assert.equal(specApprovedTag("T-007"), "spec-approved/T-007");
  });
});
