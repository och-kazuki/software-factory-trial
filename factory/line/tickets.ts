import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TICKET_ID } from "../checks/diff-scope-lib.ts";
import { FactoryError } from "./exec.ts";
import { INBOX_DIR } from "./paths.ts";

export interface Ticket {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

// YAML のライブラリを入れずに済むよう、前付けは「key: value」の行だけを受け付ける
export function parseTicket(text: string): Ticket {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---")
    throw new FactoryError("ticket must start with a '---' front matter line");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new FactoryError("ticket front matter is not closed with '---'");
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) fields.set(m[1], m[2].trim());
  }
  const id = fields.get("id") ?? "";
  const title = fields.get("title") ?? "";
  if (!TICKET_ID.test(id)) throw new FactoryError(`ticket id must look like T-001 (got '${id}')`);
  if (title === "") throw new FactoryError("ticket title is empty");
  return { id, title, text };
}

export function loadTicket(id: string): Ticket {
  if (!TICKET_ID.test(id)) throw new FactoryError(`ticket id must look like T-001 (got '${id}')`);
  const path = join(INBOX_DIR, `${id}.md`);
  if (!existsSync(path)) throw new FactoryError(`ticket not found: tickets/inbox/${id}.md`);
  const ticket = parseTicket(readFileSync(path, "utf8"));
  if (ticket.id !== id) {
    throw new FactoryError(`ticket id in front matter (${ticket.id}) does not match ${id}`);
  }
  return ticket;
}
