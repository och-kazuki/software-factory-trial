import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runCli, withTempDir } from "./helpers.ts";

const HELP =
  "Usage: mdtask <command> [options]\n\nCommands:\n  add <title>    Add a task to tasks.md\n\nOptions:\n  -h, --help     Show this help\n  -v, --version  Show the version\n";

function tasksPath(dir: string): string {
  return join(dir, "tasks.md");
}

function readTasks(dir: string): string {
  return readFileSync(tasksPath(dir), "utf8");
}

function writeTasks(dir: string, content: string): void {
  writeFileSync(tasksPath(dir), content, "utf8");
}

test("AC1: add creates tasks.md with the first task", () => {
  withTempDir((dir) => {
    const result = runCli(["add", "Buy", "milk"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 1: Buy milk\n");
    assert.equal(result.stderr, "");
    assert.equal(readTasks(dir), "- [ ] Buy milk\n");
  });
});

test("AC2: add appends a task to an existing tasks.md", () => {
  withTempDir((dir) => {
    writeTasks(dir, "- [ ] Buy milk\n");
    const result = runCli(["add", "Write report"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 2: Write report\n");
    assert.equal(result.stderr, "");
    assert.equal(readTasks(dir), "- [ ] Buy milk\n- [ ] Write report\n");
  });
});

test("AC3: the task number counts checklist lines only, including completed ones", () => {
  withTempDir((dir) => {
    writeTasks(dir, "# Tasks\n\nSome notes.\n- [x] Done task\n- [ ] Open task\n");
    const result = runCli(["add", "Next"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 3: Next\n");
    assert.equal(
      readTasks(dir),
      "# Tasks\n\nSome notes.\n- [x] Done task\n- [ ] Open task\n- [ ] Next\n",
    );
  });
});

test("AC4: add inserts a newline before appending when the file lacks a trailing newline", () => {
  withTempDir((dir) => {
    writeTasks(dir, "- [ ] First");
    const result = runCli(["add", "Second"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 2: Second\n");
    assert.equal(readTasks(dir), "- [ ] First\n- [ ] Second\n");
  });
});

test("AC5: add writes the task without a leading newline into an empty tasks.md", () => {
  withTempDir((dir) => {
    writeTasks(dir, "");
    const result = runCli(["add", "First"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 1: First\n");
    assert.equal(readTasks(dir), "- [ ] First\n");
  });
});

test("AC6: add joins multiple arguments with a single space", () => {
  withTempDir((dir) => {
    const result = runCli(["add", "Buy", "fresh", "milk"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 1: Buy fresh milk\n");
    assert.equal(readTasks(dir), "- [ ] Buy fresh milk\n");
  });
});

test("AC7: add trims surrounding whitespace from the title", () => {
  withTempDir((dir) => {
    const result = runCli(["add", "  Buy milk  "], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 1: Buy milk\n");
    assert.equal(readTasks(dir), "- [ ] Buy milk\n");
  });
});

test("AC8: add without a title fails and does not create tasks.md", () => {
  withTempDir((dir) => {
    const result = runCli(["add"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "mdtask: task title is required\n");
    assert.equal(existsSync(tasksPath(dir)), false);
  });
});

for (const title of ["", "   "]) {
  test(`AC9: add with a blank title ${JSON.stringify(title)} fails and leaves tasks.md unchanged`, () => {
    withTempDir((dir) => {
      writeTasks(dir, "- [ ] Buy milk\n");
      const result = runCli(["add", title], { cwd: dir });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "mdtask: task title is required\n");
      assert.equal(readTasks(dir), "- [ ] Buy milk\n");
    });
  });
}

test("AC10: add with a multi-line title fails and does not create tasks.md", () => {
  withTempDir((dir) => {
    const result = runCli(["add", "Line one\nLine two"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "mdtask: task title must be a single line\n");
    assert.equal(existsSync(tasksPath(dir)), false);
  });
});

test("AC11: arguments after add are treated as the title, not as options", () => {
  withTempDir((dir) => {
    const result = runCli(["add", "--help"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "Added task 1: --help\n");
    assert.equal(readTasks(dir), "- [ ] --help\n");
  });
});

test("AC12: --help lists the add command", () => {
  withTempDir((dir) => {
    const result = runCli(["--help"], { cwd: dir });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, HELP);
  });
});

test("AC13: an unknown command prints the updated usage to stderr", () => {
  withTempDir((dir) => {
    const result = runCli(["frobnicate"], { cwd: dir });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `mdtask: unknown command 'frobnicate'\n\n${HELP}`);
  });
});
