import { VERSION } from "./version.ts";

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE = `Usage: mdtask <command> [options]

Commands:
  (none yet)

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

export function run(argv: readonly string[]): CliResult {
  const [first] = argv;
  if (first === undefined || first === "-h" || first === "--help") {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  if (first === "-v" || first === "--version") {
    return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  }
  return { code: 1, stdout: "", stderr: `mdtask: unknown command '${first}'\n\n${USAGE}` };
}
