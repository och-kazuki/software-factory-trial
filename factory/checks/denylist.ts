import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { denylistRule, parseDenylist, type Rule } from "./secret-scan-lib.ts";

export function denylistPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return process.env.FACTORY_DENYLIST ?? join(configHome, "software-factory", "denylist.txt");
}

export type DenylistState =
  | { readonly status: "loaded"; readonly rule: Rule; readonly path: string }
  | { readonly status: "missing" | "empty"; readonly path: string };

export function loadDenylist(): DenylistState {
  const path = denylistPath();
  if (!existsSync(path)) return { status: "missing", path };
  const rule = denylistRule(parseDenylist(readFileSync(path, "utf8")));
  return rule === null ? { status: "empty", path } : { status: "loaded", rule, path };
}
