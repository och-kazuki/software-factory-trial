import { VERSION } from "./version.ts";

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// run() に副作用を持たせないため、tasks.md の読み書きは呼び出し側から渡してもらう
export interface TaskStore {
  // ファイルがないときは undefined を返す。空ファイルと区別したいので空文字列にはしない
  read(): string | undefined;
  write(content: string): void;
}

const USAGE = `Usage: mdtask <command> [options]

Commands:
  add <title>    Add a task to tasks.md

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

// list や done でも同じ番号を使うので、数え方はここに一つだけ置く
const TASK_LINE = /^- \[[ xX]\] /;

export function run(argv: readonly string[], store?: TaskStore): CliResult {
  const [first, ...rest] = argv;
  if (first === undefined || first === "-h" || first === "--help") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  if (first === "-v" || first === "--version") {
    return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  }
  if (first === "add") {
    // ヘルプやバージョン表示はファイルを使わないので、store は add のときだけ求める
    if (store === undefined) {
      throw new Error("add requires a task store");
    }
    return add(rest, store);
  }
  return { code: 1, stdout: "", stderr: `mdtask: unknown command '${first}'\n\n${USAGE}` };
}

function add(args: readonly string[], store: TaskStore): CliResult {
  // String.prototype.trim() は改行や全角空白まで取り除くため、仕様どおりスペースとタブだけに絞る
  const title = args.join(" ").replace(/^[ \t]+|[ \t]+$/g, "");
  if (title === "") {
    return { code: 1, stdout: "", stderr: "mdtask: task title is required\n" };
  }
  if (/[\r\n]/.test(title)) {
    return { code: 1, stdout: "", stderr: "mdtask: task title must be a single line\n" };
  }

  const existing = store.read() ?? "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  const content = `${existing}${separator}- [ ] ${title}\n`;
  store.write(content);

  const number = content.split("\n").filter((line) => TASK_LINE.test(line)).length;
  return { code: 0, stdout: `Added task ${number}: ${title}\n`, stderr: "" };
}
