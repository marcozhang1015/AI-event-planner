import { readFileSync } from "node:fs";
import type { Handle } from "../types";
import type { Contact } from "./context";

/** demo 通讯录：{ "Sam": "+15551234567", ... }。以 "_" 开头的键是注释。 */
export function loadContacts(path: string): Contact[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    return Object.entries(raw)
      .filter(([name]) => !name.startsWith("_"))
      .map(([name, handle]) => ({ name, handle }));
  } catch {
    console.warn(`[contacts] 读不到 ${path}；先运行 cp fixtures/contacts.example.json ${path}`);
    return [];
  }
}

export function nameFor(contacts: Contact[], handle: Handle): string | undefined {
  return contacts.find((contact) => contact.handle === handle)?.name;
}
