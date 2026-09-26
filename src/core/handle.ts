// handle 的统一写法和通讯录：通讯录、入站消息的发送者、联系人卡片都先过 normalizeHandle()，才能互相对得上。
// 通讯录文件由 config.ts 的 loadContacts() 读入。

import type { Handle } from "../shared/types";

export type HandlePlatform = "sim" | "terminal" | "imessage";

/** demo 通讯录里的一个人：组织者打名字时用它查号码。handle 已经规范化。 */
export interface Contact {
  name: string;
  handle: Handle;
}

export function nameFor(contacts: Contact[], handle: Handle): string | undefined {
  return contacts.find((contact) => contact.handle === handle)?.name;
}

/** 号码 → E.164（默认美国号码）。认不出的原样返回（去掉空格和符号）。 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

/** `sim:` / `term:` 原样保留；邮箱转小写；号码转 E.164；其他原样返回。 */
export function normalizeHandle(raw: string): Handle {
  const value = raw.trim();
  if (value.startsWith("sim:") || value.startsWith("term:")) return value;
  if (value.includes("@")) return value.toLowerCase();
  if (/^\+?[\d\s().-]+$/.test(value)) return normalizePhone(value);
  return value;
}

/** handle 的前缀决定走哪个平台：`sim:` 网页模拟器，`term:` 终端，其余是 iMessage 号码或邮箱。 */
export function platformOf(handle: Handle): HandlePlatform {
  if (handle.startsWith("sim:")) return "sim";
  if (handle.startsWith("term:")) return "terminal";
  return "imessage";
}

/** 规范化之后还像一个能发 iMessage 的地址吗（E.164 号码或邮箱）。 */
export function isValidHandle(handle: Handle): boolean {
  if (platformOf(handle) !== "imessage") return handle.length > handle.indexOf(":") + 1;
  return /^\+\d{8,15}$/.test(handle) || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(handle);
}
