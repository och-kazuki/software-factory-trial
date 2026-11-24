import { readFileSync, writeFileSync } from "node:fs";
import { type CliResult, run, type TaskStore } from "./cli.ts";

const TASKS_FILE = "tasks.md";

const store: TaskStore = {
  read() {
    try {
      return readFileSync(TASKS_FILE, "utf8");
    } catch (error) {
      // ファイルがないのは正常な状態（add が新しく作る）。それ以外の失敗は呼び出し元に伝える
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  },
  write(content) {
    writeFileSync(TASKS_FILE, content, "utf8");
  },
};

let result: CliResult;
try {
  result = run(process.argv.slice(2), store);
} catch (error) {
  // 権限エラーなどでスタックトレースを利用者に見せないよう、短いメッセージにして終了コード 1 で終える
  const message = error instanceof Error ? error.message : String(error);
  result = { code: 1, stdout: "", stderr: `mdtask: ${message}\n` };
}
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
