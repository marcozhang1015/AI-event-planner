// 规则解析：LLM 不可用时的回退（§5.12），也用来校验 LLM 给的值；批准、核实这类命令只认规则，不交给 LLM。
// 只求常见说法能过，不追求覆盖所有写法。

import { addDays, fromMinutes, toMinutes, WEEKDAYS, weekdayOf } from "../shared/time";
import type { Drives, LocalTime, TimeWindow } from "../shared/types";

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,。！？，~]+$/u, "")
    .trim();
}

function matchesWord(text: string, word: string): boolean {
  // 中文没有空格，按前缀匹配；英文要求整词
  if (/[^\x00-\x7f]/.test(word)) return text.startsWith(word);
  return text === word || text.startsWith(`${word} `) || text.startsWith(`${word},`);
}

const YES = ["yes", "y", "yep", "yeah", "yup", "ya", "sure", "ok", "okay", "right", "correct", "perfect", "sounds good", "looks good", "works", "that works", "happy to", "of course", "absolutely", "👍", "对", "是", "好", "可以", "没问题"];
const NO = ["no", "n", "nope", "nah", "not really", "wrong", "sorry, no", "不", "不对", "不是"];

export function parseYesNo(text: string): boolean | undefined {
  const t = norm(text);
  if (YES.some((word) => matchesWord(t, word))) return true;
  if (NO.some((word) => matchesWord(t, word))) return false;
  return undefined;
}

const SKIP = ["skip", "no", "nope", "nah", "no thanks", "no thank you", "pass", "不用", "跳过", "算了"];

export function isSkip(text: string): boolean {
  const t = norm(text);
  return SKIP.some((word) => matchesWord(t, word));
}

/** 明确说不来了："no" / "nope" 单独一句，或者 can't make it / count me out。"no, I'll find my own ride" 不算。 */
export function isDecline(text: string): boolean {
  const t = norm(text);
  return /^(?:no|nope|nah|not anymore|no thanks)$/.test(t) || /\b(?:can'?t (?:make it|come)|not coming|count me out|i'?ll (?:pass|skip it|sit this one out))\b|不去了|去不了/.test(t);
}

/** "not now" / "later" / "busy"：现在不方便，晚点再说。 */
export function isDeferral(text: string): boolean {
  const t = norm(text);
  return parseYesNo(t) === false || /^(?:not (?:right )?now|(?:maybe )?later|busy|in a (?:bit|sec|minute|meeting)|can'?t (?:talk )?(?:right )?now|not a good time)\b|^(?:晚点|等下|等一下|现在不行|在忙)/.test(t);
}

/** 以问号结尾，或者以疑问词开头。 */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /[?？]\s*$/.test(t) || /^(?:who|what|when|where|why|how|which|is|are|do|does|did|can|could|will|would|should)\b/.test(t);
}

const MONEY_PATTERNS = [
  /\$\s*(\d+(?:\.\d{1,2})?)/,
  /(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd|刀|美元|块)/i,
  /(?:max|at most|under|up to|no more than|最多|不超过)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  /(\d+(?:\.\d{1,2})?)\s*(?:max|at most|or less|tops|以内|以下)/i,
  /^\s*(\d+(?:\.\d{1,2})?)\s*$/,
];

export function parseMoneyCents(text: string): number | undefined {
  const cleaned = text.replace(/,/g, "");
  for (const pattern of MONEY_PATTERNS) {
    const value = cleaned.match(pattern)?.[1];
    if (value !== undefined) return Math.round(Number(value) * 100);
  }
  return undefined;
}

/** 没写 am/pm 时，1–7 点按下午算（活动大多在下午和晚上）。 */
export function parseTimeOfDay(fragment: string, context = fragment): LocalTime | undefined {
  const match = fragment.match(/(\d{1,2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?\b)?/i);
  if (!match?.[1]) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return undefined;
  const meridiem = match[3]?.toLowerCase() ?? (/下午|晚上|傍晚/.test(context) ? "p" : /上午|早上/.test(context) ? "a" : undefined);
  if (meridiem === "p" && hours < 12) hours += 12;
  else if (meridiem === "a" && hours === 12) hours = 0;
  else if (!meridiem && hours >= 1 && hours <= 7) hours += 12;
  return fromMinutes(hours * 60 + minutes);
}

/** 没写 am/pm、又早于活动开始的时刻，按下午/晚上理解（"home by 10" → 22:00）。 */
function alignToWindow(time: LocalTime | undefined, window?: TimeWindow): LocalTime | undefined {
  if (!time || !window) return time;
  const minutes = toMinutes(time);
  if (minutes < toMinutes(window.start) && minutes < 12 * 60) return fromMinutes(minutes + 12 * 60);
  return time;
}

const TIME_TOKEN = String.raw`\d{1,2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?`;

export function parseTimeWindow(text: string, window?: TimeWindow): Partial<TimeWindow> | undefined {
  const t = text.toLowerCase();
  if (/any ?time|all day|whenever|flexible|either|都可以|都行|随时/.test(t)) return {};

  const range = t.match(new RegExp(`(${TIME_TOKEN})\\s*(?:-|–|—|~|to|till|until|到|至)\\s*(${TIME_TOKEN})`));
  if (range?.[1] && range[2]) {
    const start = alignToWindow(parseTimeOfDay(range[1], t), window);
    let end = alignToWindow(parseTimeOfDay(range[2], t), window);
    if (start && end && toMinutes(end) <= toMinutes(start) && !/[ap]\.?m/.test(range[2])) {
      end = fromMinutes(toMinutes(end) + 12 * 60);
    }
    return { start, end };
  }

  const after =
    t.match(new RegExp(`(?:after|from|since|start(?:ing)?(?:\\s+at)?)\\s*(${TIME_TOKEN})`)) ?? t.match(/(\d{1,2}(?::\d{2})?)\s*点?\s*(?:以后|之后|后|开始)/);
  if (after?.[1]) return { start: alignToWindow(parseTimeOfDay(after[1], t), window) };

  const before = t.match(new RegExp(`(?:before|until|till)\\s*(${TIME_TOKEN})`)) ?? t.match(/(\d{1,2}(?::\d{2})?)\s*点?\s*(?:以前|之前|前)/);
  if (before?.[1]) return { end: alignToWindow(parseTimeOfDay(before[1], t), window) };

  return undefined;
}

export function parseHomeBy(text: string, window?: TimeWindow): LocalTime | undefined {
  const match = text.toLowerCase().match(new RegExp(`(?:home by|back by|leave by|out by|done by)\\s*(${TIME_TOKEN})`));
  if (!match?.[1]) return undefined;
  return alignToWindow(parseTimeOfDay(match[1], text), window);
}

const ZH_WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function nextWeekday(today: string, weekday: number): string {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7);
}

/** "saturday" / "sat" / "tomorrow" / "9/27" / "2026-09-27" / "周六" → YYYY-MM-DD。 */
export function parseDay(text: string, today: string): string | undefined {
  const t = text.toLowerCase();
  if (/\btoday\b|\btonight\b|今天|今晚/.test(t)) return today;
  if (/\btomorrow\b|明天/.test(t)) return addDays(today, 1);

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthDay = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (monthDay?.[1] && monthDay[2]) {
    const year = Number(today.slice(0, 4));
    const suffix = `${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
    const candidate = `${year}-${suffix}`;
    return candidate >= today ? candidate : `${year + 1}-${suffix}`;
  }

  for (const [index, name] of WEEKDAYS.entries()) {
    if (t.includes(name) || new RegExp(`\\b${name.slice(0, 3)}\\b`).test(t)) return nextWeekday(today, index);
  }

  const zh = t.match(/(?:周|星期|礼拜)([一二三四五六日天])/)?.[1];
  const zhIndex = zh === undefined ? undefined : ZH_WEEKDAYS[zh];
  if (zhIndex !== undefined) return nextWeekday(today, zhIndex);
  return undefined;
}

export function parseDrives(text: string): Drives | undefined {
  const t = text.toLowerCase();
  if (/if (?:needed|necessary|i have to|need be)|prefer not|rather not|必要的话|实在不行|不想开/.test(t)) return "if_needed";
  if (/need a ride|no car|don'?t (?:drive|have a car)|can'?t drive|cannot drive|pick me up|car'?s in the shop|没车|需要.*接|要人接|搭车|开不了/.test(t)) return "no";
  if (/\bi(?:'m| am)? driving\b|\b(?:i )?(?:can|will|could) drive\b|\bi have a car\b|\bi'?ve got a car\b|我开车|我有车|我可以开/.test(t)) return "yes";
  return undefined;
}

export function parseSeats(text: string): number | undefined {
  const t = text.toLowerCase();
  const match =
    t.match(/(\d+)\s*(?:seats?|spots?|people|passengers?|个座位?|个人|人)/) ?? t.match(/(?:take|drive|fit|carry|带)\s*(\d+)/) ?? t.match(/^\s*(\d+)\s*$/);
  if (!match?.[1]) return undefined;
  const seats = Number(match[1]);
  return seats >= 0 && seats <= 8 ? seats : undefined;
}

const NONE = ["none", "no", "nope", "nothing", "nah", "n/a", "no allergies", "not really", "i eat everything", "没有", "无", "都能吃", "都可以"];

const SEVERE = /\b(?:pretty |very |really )?(?:severe(?:ly)?|serious(?:ly)?|anaphylactic)\b|严重/g;

/** 过敏/忌口：说"没有"返回 []；否则拆成若干项。说了"严重"就在每一项后面标上 (severe)，方案里要写出来。 */
export function parseList(text: string): string[] | undefined {
  const t = norm(text);
  if (!t) return undefined;
  if (NONE.some((word) => matchesWord(t, word))) return [];
  const severe = new RegExp(SEVERE.source).test(t);
  const items = t
    .replace(/\b(?:i'?m |i am )?allergic to\b|\ballerg(?:y|ies)\b/g, " ")
    .replace(SEVERE, " ")
    .split(/,|\band\b|&|、|和|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items.map((item) => (severe ? `${item} (severe)` : item)) : undefined;
}

export function parseEmail(text: string): string | undefined {
  return text.match(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/i)?.[0]?.toLowerCase();
}

const PLAN_WORDS = /\b(?:plan|organi[sz]e|set up|dinner|lunch|brunch|hike|party|trip|picnic|hang ?out|get ?together|game night|movie)\b|组织|安排|聚|约/;

export function looksLikePlan(text: string): boolean {
  return PLAN_WORDS.test(text.toLowerCase());
}

// 组织者的命令

/** "plan it" / "go ahead"：不等还没回复的人，现在就排。 */
export function isPlanRequest(text: string): boolean {
  return /\bplan it\b|\bgo ahead\b|\bmake (?:the|a) plan\b|\bplan (?:it )?now\b|\blet'?s plan\b|开始排|排吧/i.test(text);
}

/** "approve A" / "approve"：只认以 approve 开头的明确文字（tapback 和问句都不算）。返回选项字母（没说是 undefined）。 */
export function parseApproval(text: string): { label?: string } | undefined {
  if (/[?？]/.test(text)) return undefined;
  const match = text.trim().match(/^(?:(?:ok(?:ay)?|yes|great|perfect|looks good)[,!.\s]+)?(?:approve[ds]?|批准)(?:\s+(?:plan\s+|方案\s*)?([ab]))?(?![a-z])/i);
  return match ? { label: match[1]?.toUpperCase() } : undefined;
}

/** 组织者说核实过了（"just called, they said they can do it"）：true 能处理，false 不能；没提到核实是 undefined。 */
export function parseVerification(text: string): boolean | undefined {
  const t = text.toLowerCase();
  if (!/\b(?:called|call(?:ed)? them|phoned|spoke|talked|checked|asked)\b|打过电话|问过|确认过|核实/.test(t)) return undefined;
  if (/\b(?:can'?t|cannot|won'?t|unable to|not able to|no way|(?:not|isn'?t|aren'?t) safe|they said no)\b|不行|不能|没法|不可以/.test(t)) return false;
  if (/\b(?:can|could|will|fine|ok(?:ay)?|safe|good|yes|no problem|handle|nut-free|allergy-friendly)\b|可以|没问题|能/.test(t)) return true;
  return undefined;
}

/** 组织者改设置要有明确的说法（"can we start at 4?"），免得把他补答自己约束的话当成改活动。 */
export function hasChangeCue(text: string): boolean {
  return /\b(?:change|move|switch|make it|can we|could we|let'?s|instead|start(?:ing)? at|push|earlier|later|budget|cap|different day|another day)\b|改|换|推迟|提前/i.test(text);
}

/** 收集阶段要有邀请的说法（或联系人卡片）才算邀请，免得 "has sam answered yet?" 被当成名单。 */
export function isInviteRequest(text: string): boolean {
  return /\b(?:invite|add|also (?:ask|text|invite)|include|bring|loop in)\b|邀请|加上|叫上|再叫/i.test(text);
}

/** 组织者说自己也去 / 不去；没提到是 undefined。 */
export function parseJoining(text: string): boolean | undefined {
  const t = text.toLowerCase();
  if (/\b(?:i'?m not (?:coming|going|joining)|not me|without me|count me out|i can'?t (?:come|make it)|just organi[sz]ing)\b|我不去|我不参加/.test(t)) return false;
  if (/\b(?:i'?m (?:also )?(?:in|coming|joining|going)(?: too)?|me too|count me in|i'?ll (?:come|join|be there)|include me|and me|me as well)\b|我也去|算我一个|我也参加/.test(t)) return true;
  return undefined;
}

/** 回编号选候选："2" / "#2" / "the second one"。超出范围返回 undefined。 */
export function parseChoice(text: string, count: number): number | undefined {
  const t = norm(text);
  const ordinal = ["first", "second", "third"].findIndex((word) => new RegExp(`\\b${word}\\b`).test(t));
  const number = ordinal >= 0 ? ordinal + 1 : Number(t.match(/^(?:#|no\.?\s*|option\s*)?(\d)\b/)?.[1]);
  return Number.isInteger(number) && number >= 1 && number <= count ? number : undefined;
}
