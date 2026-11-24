import { spawnSync } from "node:child_process";

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
}

export class FactoryError extends Error {}

export function exec(cmd: string, args: readonly string[], options: ExecOptions = {}): ExecResult {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function execOk(cmd: string, args: readonly string[], options: ExecOptions = {}): string {
  const result = exec(cmd, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-20).join("\n");
    throw new FactoryError(`${cmd} ${args.join(" ")} failed (exit ${result.code})\n${detail}`);
  }
  return result.stdout;
}

export function tail(text: string, lines = 60): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}
