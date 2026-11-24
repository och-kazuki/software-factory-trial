import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../../src/cli.ts";
import { VERSION } from "../../src/version.ts";

test("--version prints the version", () => {
  assert.deepEqual(run(["--version"]), { code: 0, stdout: `${VERSION}\n`, stderr: "" });
});

test("no arguments prints usage", () => {
  const result = run([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: mdtask/);
});

test("an unknown command fails with usage on stderr", () => {
  const result = run(["frobnicate"]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unknown command 'frobnicate'/);
});
