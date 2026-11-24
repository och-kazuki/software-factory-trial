import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildArgs, buildSettings, type RoleDefinition, scrubbedEnv } from "./claude.ts";
import { parseConfig } from "./config.ts";
import { renderReview, renderSpec } from "./documents.ts";
import { parseStatus } from "./git.ts";
import { type LedgerEntry, localDay, spentOnDay, spentOnTicket } from "./ledger.ts";
import { sanitize } from "./outgoing.ts";
import { parseTicket } from "./tickets.ts";

const builderRole: RoleDefinition = {
  tools: ["Read", "Bash"],
  restricted: false,
  permissions: { allow: ["Read", "Bash(npm test)"], deny: ["Read(~/.ssh/**)"] },
};

describe("parseTicket", () => {
  test("reads id and title from front matter", () => {
    const ticket = parseTicket("---\nid: T-001\ntitle: add command\n---\n\nbody\n");
    assert.equal(ticket.id, "T-001");
    assert.equal(ticket.title, "add command");
  });

  test("rejects malformed tickets", () => {
    assert.throws(() => parseTicket("id: T-001\n"), /front matter/);
    assert.throws(() => parseTicket("---\nid: X-1\ntitle: t\n---\n"), /ticket id/);
    assert.throws(() => parseTicket("---\nid: T-001\n---\n"), /title/);
  });
});

describe("config", () => {
  const valid = {
    models: { planner: "m", testWriter: "m", builder: "m", reviewer: "m" },
    usageCapsUsdEquivalent: {
      planner: 1,
      testWriter: 1,
      builder: 2,
      reviewer: 1,
      perTicket: 5,
      perDay: 10,
    },
    maxBuildAttempts: 3,
    maxTestWriterAttempts: 2,
  };

  test("accepts a complete config", () => {
    assert.equal(parseConfig(valid).maxBuildAttempts, 3);
  });

  test("lists every invalid field", () => {
    const broken = { ...valid, maxBuildAttempts: 0, models: { ...valid.models, builder: "" } };
    assert.throws(() => parseConfig(broken), /models\.builder.*maxBuildAttempts/);
  });
});

describe("claude invocation", () => {
  test("isolates user-level settings and excludes the user CLAUDE.md", () => {
    const settings = JSON.parse(buildSettings(builderRole, "/fake-home"));
    assert.deepEqual(settings.claudeMdExcludes, ["/fake-home/.claude/CLAUDE.md"]);
    assert.deepEqual(settings.permissions.allow, ["Read", "Bash(npm test)"]);
  });

  test("never asks for permission and passes the budget", () => {
    const args = buildArgs(builderRole, "role prompt", "model-x", 2.5);
    const joined = args.join(" ");
    assert.match(joined, /--setting-sources project/);
    assert.match(joined, /--permission-mode dontAsk/);
    assert.match(joined, /--permission-prompts none/);
    assert.match(joined, /--max-budget-usd 2\.5/);
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.ok(!args.includes("--restricted"));
  });

  test("adds --restricted and the schema for read-only roles", () => {
    const args = buildArgs({ ...builderRole, restricted: true }, "p", "m", 1, { type: "object" });
    assert.ok(args.includes("--restricted"));
    assert.ok(args.includes("--json-schema"));
  });

  test("removes credentials from the environment", () => {
    const env = scrubbedEnv({ GH_TOKEN: "x", SSH_AUTH_SOCK: "/s", PATH: "/bin" });
    assert.deepEqual(env, { PATH: "/bin" });
  });
});

describe("documents", () => {
  test("renders a spec with acceptance criteria", () => {
    const md = renderSpec("T-001", {
      title: "add",
      summary: "summary",
      behavior: ["b1"],
      acceptance_criteria: [{ id: "AC1", given: "g", when: "w", outcome: "t" }],
      out_of_scope: [],
      open_questions: [],
    });
    assert.match(md, /^# T-001: add/);
    assert.match(md, /### AC1\n\n- 前提: g\n- 操作: w\n- 結果: t/);
    assert.match(md, /## 未解決の質問\n\n- （なし）/);
  });

  test("escapes table-breaking characters in review findings", () => {
    const md = renderReview({
      verdict: "comment",
      summary: "s",
      findings: [{ severity: "minor", file: "a.ts", line: 3, message: "x | y\nz" }],
    });
    assert.match(md, /\| minor \| `a\.ts:3` \| x \\\| y z \|/);
  });
});

describe("parseStatus", () => {
  test("reads modified, untracked and renamed entries", () => {
    const out = [" M product/src/cli.ts", "?? product/src/new.ts", "R  b.ts", "a.ts", ""].join(
      "\0",
    );
    assert.deepEqual(
      parseStatus(out).map((e) => e.path),
      ["product/src/cli.ts", "product/src/new.ts", "b.ts", "a.ts"],
    );
  });
});

describe("ledger", () => {
  const entry = (ticket: string, ts: string, cost: number): LedgerEntry => ({
    ts,
    ticket,
    stage: "s",
    model: "m",
    subtype: "success",
    costUsdEquivalent: cost,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 0,
    turns: 0,
    permissionDenials: 0,
  });

  test("sums usage per ticket and per local day", () => {
    const now = new Date();
    const entries = [
      entry("T-001", now.toISOString(), 1.25),
      entry("T-001", now.toISOString(), 0.5),
      entry("T-002", new Date(now.getTime() - 3 * 86_400_000).toISOString(), 4),
    ];
    assert.equal(spentOnTicket(entries, "T-001"), 1.75);
    assert.equal(spentOnDay(entries, localDay(now)), 1.75);
  });
});

describe("sanitize", () => {
  test("hides home paths and personal email addresses", () => {
    const home = ["", "home", "someone"].join("/");
    const email = ["dev", "corp.example.jp"].join("@");
    const out = sanitize(`at ${home}/src/x.ts by ${email}`, home);
    assert.equal(out, "at ~/src/x.ts by <email>");
  });

  test("keeps allowed addresses", () => {
    const email = ["1+bot", "users.noreply.github.com"].join("@");
    assert.equal(sanitize(email, "/nonexistent"), email);
  });
});
