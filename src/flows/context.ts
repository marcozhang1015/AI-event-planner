// 每个 flow 函数拿到的东西：依赖（FlowDeps）和这一轮收到的消息（Turn），以及 flow 共用的几个小工具。
// flow 只通过 deps.db（ChangeSet）读写数据，只返回出站动作（out/actions.ts），不直接写库、不直接发消息。

import type { Brain, BrainContext } from "../brain/extract";
import { parseYesNo } from "../brain/parse";
import { platformOf, type Contact } from "../core/handle";
import type { Maps } from "../maps";
import type { ViewOptions } from "../out/privacy";
import { quietUntil, todayIn, weekdayName, type QuietHours } from "../shared/time";
import type { Answer, Extraction, Handle, Member, Role } from "../shared/types";
import type { ChangeSet } from "../store/changes";
import { newToken } from "../store/db";

/** `baseUrl`、`mapImages` 来自 ViewOptions：deps 可以直接传给生成视图的函数。 */
export interface FlowDeps extends ViewOptions {
  db: ChangeSet;
  brain: Brain;
  /** LLM 关闭时给 Peter 使用的固定真机演示剧本。 */
  scriptedPeter?: boolean;
  maps: Maps;
  now: Date;
  timezone: string;
  agentName: string;
  /** demo 通讯录：组织者打名字时用它查号码。handle 已经规范化。 */
  contacts: Contact[];
  /** 地图搜索时附加的地区，比如 "St. Louis, MO"。 */
  mapsRegion?: string;
  /** 夜间免打扰：管线把发给别人的消息推迟到时段结束，flow 在回复里说明几点发。 */
  quietHours?: QuietHours;
  /** 发件人，也是日历邀请里的 ORGANIZER。 */
  emailFrom: string;
}

// 这一轮收到的消息

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

// Claude

/** 给 Claude 的上下文：今天、最近 10 条对话、这一轮的新消息，加上调用方给的活动信息和字段（§5.4 上下文最小化）。 */
export function brainContext(deps: FlowDeps, turn: Turn, fields: Pick<BrainContext, "eventLine" | "known" | "missing">): BrainContext {
  const today = todayIn(deps.timezone, deps.now);
  const history = deps.db.store.historyFor(turn.handle, 10).map((message) => ({ from: message.direction === "outbound" ? ("juno" as const) : ("them" as const), text: message.text }));
  return { today: `${today} (${weekdayName(today)})`, ...fields, history, incoming: textsOf(turn) };
}

/** 下一个问题：Claude 的措辞只有在它问的正是代码算出的下一个字段时才用，否则用模板。 */
export function nextQuestion(ai: Extraction<unknown> | undefined, field: string, template: string): string {
  return ai?.askingAbout === field && ai.reply ? ai.reply : template;
}

// 其他

/** 现在是不是夜间免打扰时段：是的话返回时段结束的时刻。 */
export function quietNow(deps: FlowDeps): Date | undefined {
  return quietUntil(deps.now, deps.timezone, deps.quietHours);
}

export function newMember(eventId: string, handle: Handle, name: string, role: Role): Member {
  return { eventId, handle, name, linkToken: newToken(), role, status: role === "organizer" ? "confirmed" : "invited", simulated: platformOf(handle) !== "imessage" };
}

export function emptyAnswer(eventId: string, handle: Handle): Answer {
  return { eventId, handle, confirmed: false, version: 0 };
}
