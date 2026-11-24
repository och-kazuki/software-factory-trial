import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_DIR } from "./paths.ts";

export const ROLES = ["planner", "testWriter", "builder", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export interface FactoryConfig {
  readonly models: Readonly<Record<Role, string>>;
  readonly usageCapsUsdEquivalent: Readonly<Record<Role, number>> & {
    readonly perTicket: number;
    readonly perDay: number;
  };
  readonly maxBuildAttempts: number;
  readonly maxTestWriterAttempts: number;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseConfig(raw: unknown): FactoryConfig {
  const errors: string[] = [];
  const obj = (raw ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const models = (obj.models ?? {}) as Record<string, unknown>;
  const caps = (obj.usageCapsUsdEquivalent ?? {}) as Record<string, unknown>;
  for (const role of ROLES) {
    if (typeof models[role] !== "string" || models[role] === "") errors.push(`models.${role}`);
    if (!isPositiveNumber(caps[role])) errors.push(`usageCapsUsdEquivalent.${role}`);
  }
  for (const key of ["perTicket", "perDay"]) {
    if (!isPositiveNumber(caps[key])) errors.push(`usageCapsUsdEquivalent.${key}`);
  }
  for (const key of ["maxBuildAttempts", "maxTestWriterAttempts"]) {
    const value = obj[key];
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) {
      errors.push(key);
    }
  }
  if (errors.length > 0) throw new Error(`invalid factory config: ${errors.join(", ")}`);
  return raw as FactoryConfig;
}

export function loadConfig(path = join(FACTORY_DIR, "config.json")): FactoryConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
