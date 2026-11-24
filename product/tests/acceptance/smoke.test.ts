import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli, withTempDir } from "./helpers.ts";

test("mdtask --version prints a semantic version", () => {
  withTempDir((dir) => {
    const result = runCli(["--version"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
    assert.equal(result.stderr, "");
  });
});

test("mdtask with an unknown command exits with 1", () => {
  withTempDir((dir) => {
    const result = runCli(["frobnicate"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unknown command/);
  });
});
