import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CONTENT_RULES,
  checkPath,
  denylistRule,
  formatFinding,
  isAllowedIdentity,
  linesOf,
  parseAddedLines,
  parseDenylist,
  scanLines,
} from "./secret-scan-lib.ts";

// このファイル自体も検査対象なので、偽の秘密情報は実行時に組み立て、ソースには完全な形で書かない
const fakeGithubToken = `ghp_${"a".repeat(36)}`;
const fakeAnthropicKey = `sk-ant-${"x".repeat(30)}`;
const fakePrivateKeyHeader = `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----`;
const fakeCompanyEmail = ["someone", "corp.example.jp"].join("@");
const fakeHomePath = `/home/${"alice"}/work`;

function rulesFound(text: string): string[] {
  return scanLines(linesOf(text, "f.txt"), CONTENT_RULES).map((f) => f.rule);
}

describe("content rules", () => {
  test("detects a GitHub token", () => {
    assert.deepEqual(rulesFound(`const t = "${fakeGithubToken}";`), ["github-token"]);
  });

  test("detects an Anthropic API key", () => {
    assert.ok(rulesFound(fakeAnthropicKey).includes("anthropic-api-key"));
  });

  test("detects a private key header", () => {
    assert.deepEqual(rulesFound(fakePrivateKeyHeader), ["private-key"]);
  });

  test("detects a personal email address", () => {
    assert.deepEqual(rulesFound(`contact: ${fakeCompanyEmail}`), ["email-address"]);
  });

  test("allows noreply, example and git URL addresses", () => {
    const allowed = [
      ["12345+someone", "users.noreply.github.com"].join("@"),
      ["user", "example.com"].join("@"),
      ["git", "github.com:owner/repo.git"].join("@"),
    ];
    for (const text of allowed) assert.deepEqual(rulesFound(text), [], text);
  });

  test("detects a home directory path", () => {
    assert.deepEqual(rulesFound(`cd ${fakeHomePath}`), ["home-directory-path"]);
  });

  test("does not flag a placeholder home path", () => {
    assert.deepEqual(rulesFound("/home/<user>/src"), []);
  });

  test("reports the line number of the finding", () => {
    const findings = scanLines(linesOf(`ok\n${fakeGithubToken}\n`, "a.ts"), CONTENT_RULES);
    assert.deepEqual(
      findings.map((f) => f.location),
      ["a.ts:2"],
    );
  });
});

describe("formatFinding", () => {
  test("never includes the matched value", () => {
    const text = `${fakeGithubToken} ${fakeAnthropicKey} ${fakeCompanyEmail}`;
    const output = scanLines(linesOf(text, "x.ts"), CONTENT_RULES).map(formatFinding).join("\n");
    assert.ok(output.length > 0);
    for (const secret of [fakeGithubToken, fakeAnthropicKey, fakeCompanyEmail, "aaaaaaaa"]) {
      assert.ok(!output.includes(secret), `output leaked: ${secret.slice(0, 4)}...`);
    }
  });
});

describe("denylist", () => {
  test("ignores comments and blank lines", () => {
    assert.deepEqual(parseDenylist("# comment\n\n Foo Corp \nbar\n"), ["Foo Corp", "bar"]);
  });

  test("matches terms case-insensitively without leaking them", () => {
    const rule = denylistRule(["Foo Corp", "a.b"]);
    assert.ok(rule);
    const findings = scanLines(linesOf("made by FOO CORP\naxb\na.b", "d.md"), [rule]);
    assert.deepEqual(
      findings.map((f) => f.location),
      ["d.md:1", "d.md:3"],
    );
    assert.ok(!findings.map(formatFinding).join("").toLowerCase().includes("foo corp"));
  });

  test("returns null for an empty list", () => {
    assert.equal(denylistRule([]), null);
  });
});

describe("checkPath", () => {
  test("flags files that commonly hold secrets", () => {
    for (const path of [
      ".env",
      "config/.env.local",
      "certs/server.pem",
      "id_ed25519",
      "hosts.yml",
    ]) {
      assert.equal(checkPath(path)?.rule, "forbidden-file", path);
    }
  });

  test("allows ordinary files and the env example", () => {
    for (const path of [".env.example", "src/env.ts", "keys.md", "id_ed25519.pub"]) {
      assert.equal(checkPath(path), null, path);
    }
  });
});

describe("isAllowedIdentity", () => {
  test("allows GitHub noreply identities", () => {
    assert.ok(isAllowedIdentity(["1+someone", "users.noreply.github.com"].join("@")));
    assert.ok(isAllowedIdentity(["noreply", "github.com"].join("@")));
  });

  test("rejects other addresses", () => {
    assert.ok(!isAllowedIdentity(fakeCompanyEmail));
    assert.ok(!isAllowedIdentity(""));
  });
});

describe("parseAddedLines", () => {
  test("tracks file paths and new-side line numbers", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,0 +2,2 @@",
      "+first",
      "+second",
      "diff --git a/b.ts b/b.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/b.ts",
      "@@ -0,0 +1 @@",
      "+++ starts with plus signs",
    ].join("\n");
    assert.deepEqual(parseAddedLines(diff, "commit abc "), [
      { location: "commit abc a.ts:2", text: "first" },
      { location: "commit abc a.ts:3", text: "second" },
      { location: "commit abc b.ts:1", text: "++ starts with plus signs" },
    ]);
  });

  test("skips deleted files", () => {
    const diff = [
      "diff --git a/c.ts b/c.ts",
      "deleted file mode 100644",
      "--- a/c.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
    ].join("\n");
    assert.deepEqual(parseAddedLines(diff), []);
  });
});
