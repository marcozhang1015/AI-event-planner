import type { Brain } from "../brain/extract";
import { parseYesNo } from "../brain/parse";
import type { Maps } from "../maps";
import type { OutPart } from "../out/imessage";
import type { Answer, Handle, Member, Role } from "../types";
import type { ChangeSet } from "./changes";

export interface Contact {
  name: string;
  handle: Handle;
}

export interface FlowDeps {
  db: ChangeSet;
  brain: Brain;
  maps: Maps;
  now: Date;
  timezone: string;
  baseUrl: string;
  agentName: string;
  /** demo 通讯录：组织者打名字时用它查号码。 */
  contacts: Contact[];
  /** 地图搜索时附加的地区，比如 "St. Louis, MO"。 */
  mapsRegion?: string;
}

/** 一条入站消息里 flow 需要的部分。和 Spectrum 无关，方便测试。 */
export interface Incoming {
  id: string;
  kind: "text" | "reaction" | "contact";
  text: string;
  targetId?: string;
  contactName?: string;
  phones?: string[];
}

/** 一个人在 debounce 窗口内发来的所有消息，合并成一轮处理。 */
export interface Turn {
  handle: Handle;
  incoming: Incoming[];
}

/** flow 不直接发消息，只返回要发什么；管线确认这一轮有效后再按顺序发。 */
export type Outbound =
  | { kind: "send"; to: Handle; parts: OutPart[]; onSent?: (messageIds: string[]) => void }
  | { kind: "react"; to: Handle; messageId: string; emoji: string };

export function say(to: Handle, ...parts: OutPart[]): Outbound {
  return { kind: "send", to, parts };
}

export function react(to: Handle, messageId: string, emoji: string): Outbound {
  return { kind: "react", to, messageId, emoji };
}

export function textsOf(turn: Turn): string[] {
  return turn.incoming.filter((item) => item.kind === "text").map((item) => item.text);
}

export function textOf(turn: Turn): string {
  return textsOf(turn).join("\n");
}

export function lastTextId(turn: Turn): string | undefined {
  return turn.incoming.findLast((item) => item.kind === "text")?.id;
}

const CONFIRM_TAPBACKS = ["👍", "❤️"];

/** 对摘要点 👍 / ❤️ 算确认；文字回复用 yes/no 解析。 */
export function confirmsSummary(turn: Turn, summaryMessageId?: string): boolean | undefined {
  const tapback = turn.incoming.some(
    (item) => item.kind === "reaction" && CONFIRM_TAPBACKS.includes(item.text) && (!summaryMessageId || item.targetId === summaryMessageId),
  );
  if (tapback) return true;
  const text = textOf(turn);
  return text ? parseYesNo(text) : undefined;
}

export function onlyReactions(turn: Turn): boolean {
  return turn.incoming.length > 0 && turn.incoming.every((item) => item.kind === "reaction");
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** 个人网页链接用的 token：随机长串，不可猜。 */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url");
}

export function newMember(eventId: string, handle: Handle, name: string, role: Role): Member {
  const simulated = handle.startsWith("sim:") || handle.startsWith("term:");
  return { eventId, handle, name, linkToken: newToken(), role, status: role === "organizer" ? "confirmed" : "invited", simulated };
}

export function emptyAnswer(eventId: string, handle: Handle): Answer {
  return { eventId, handle, confirmed: false, version: 0 };
}

export function historyOf(deps: FlowDeps, handle: Handle): { from: "juno" | "them"; text: string }[] {
  return deps.db.store.historyFor(handle, 10).map((message) => ({ from: message.direction === "outbound" ? "juno" : "them", text: message.text }));
}

/** 地图搜索时带上地区提示，免得 "the library" 搜到别的城市。 */
export function withRegion(deps: FlowDeps, query: string): string {
  return deps.mapsRegion ? `${query}, ${deps.mapsRegion}` : query;
}
