// 启动配置：读环境变量（.env.example 有说明）、读 demo 通讯录，再做一遍启动检查。
// 只有 index.ts 和 scripts/ 读这里的 config；其他模块的配置都由调用方传进去。

import { readFileSync } from "node:fs";
import { isValidHandle, normalizeHandle, platformOf, type Contact } from "./core/handle";
import { fmtTime, parseQuietHours } from "./shared/time";

export type ProviderName = "imessage" | "sim" | "terminal";
export type MapsMode = "sample" | "cache" | "live";

function oneOf<const T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}="${value}" 无效，可选：${allowed.join(", ")}`);
  }
  return value as T;
}

function numberOf(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name}="${value}" 不是有效的数字`);
  return parsed;
}

const env = Bun.env;
const port = numberOf("PORT", env.PORT, 3000);

export const config = {
  providers: (env.PROVIDERS || "sim")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => oneOf("PROVIDERS", name, ["imessage", "sim", "terminal"])),
  /** 设了以后，网页模拟器要带 ?key=... 才能用。服务暴露到公网时必须设（见 preflight）。 */
  simKey: env.SIM_KEY || undefined,
  port,
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  dbPath: env.DB_PATH || "data/app.db",
  timezone: env.EVENT_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  agentName: env.AGENT_NAME || "Juno",
  contactsPath: env.CONTACTS_PATH || "fixtures/contacts.json",

  debounceMs: numberOf("DEBOUNCE_MS", env.DEBOUNCE_MS, 3000),
  paceMs: numberOf("PACE_MS", env.PACE_MS, 700),
  /** 夜间不主动给别人发消息（活动时区）。demo 时设 QUIET_HOURS=off。 */
  quietHours: parseQuietHours(env.QUIET_HOURS ?? "22-8"),
  /** 每条收发的消息打一行日志（前 80 个字）。 */
  logMessages: env.LOG_MESSAGES !== "off",

  llm: env.LLM !== "off",
  model: env.CLAUDE_MODEL || "claude-opus-5",
  llmTimeoutMs: numberOf("LLM_TIMEOUT_MS", env.LLM_TIMEOUT_MS, 8000),

  mapsMode: oneOf("MAPS_MODE", env.MAPS_MODE || "sample", ["sample", "cache", "live"]),
  /** 只在服务端用：Places、Routes，以及网页和邮件里的静态地图（由 /map/:token.png 代理，不暴露给浏览器）。 */
  mapsServerKey: env.MAPS_SERVER_KEY || undefined,
  mapsCacheDir: env.MAPS_CACHE_DIR || "fixtures/maps-cache",
  /** 地图搜索时附加的地区，比如 "St. Louis, MO"。 */
  mapsRegion: env.MAPS_REGION || undefined,

  emailDriver: env.EMAIL_DRIVER || "console",
  emailFrom: env.EMAIL_FROM || "Juno <juno@example.com>",
  outboxDir: env.OUTBOX_DIR || "data/outbox",
};

export type Config = typeof config;

// 通讯录

/** demo 通讯录：{ "Sam": "+15551234567", ... }。以 "_" 开头的键是注释。handle 统一规范化，才能和入站消息对上。 */
export function loadContacts(path: string): Contact[] {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    console.warn(`[contacts] 读不到 ${path}；先运行 cp fixtures/contacts.example.json ${path}`);
    return [];
  }
  return Object.entries(raw)
    .filter((entry): entry is [string, string] => !entry[0].startsWith("_") && typeof entry[1] === "string")
    .map(([name, handle]) => ({ name, handle: normalizeHandle(handle) }));
}

// 启动检查：真机测试前最容易漏的配置。errors 会拒绝启动，warnings 只打印。

export interface Preflight {
  errors: string[];
  warnings: string[];
}

function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".local");
  } catch {
    return false;
  }
}

type Checked = Pick<Config, "providers" | "simKey" | "publicBaseUrl" | "llm" | "mapsMode" | "quietHours">;

export function preflight(config: Checked, contacts: Contact[], env: Record<string, string | undefined> = Bun.env): Preflight {
  const errors: string[] = [];
  const warnings: string[] = [];
  const has = (provider: ProviderName) => config.providers.includes(provider);
  const publicUrl = !isLocal(config.publicBaseUrl);

  if (has("sim") && publicUrl && !config.simKey) {
    errors.push(`PUBLIC_BASE_URL=${config.publicBaseUrl} 是公网地址，启用 sim 时必须设 SIM_KEY，否则谁都能通过 /sim/ws 冒充模拟器里的人`);
  }
  if (has("imessage") && !publicUrl) warnings.push("启用了 imessage，但 PUBLIC_BASE_URL 还是本机地址：手机上的看板和行程页链接打不开，链接预览也出不来");
  if (config.llm && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    warnings.push("没设 ANTHROPIC_API_KEY：没有其他 Claude 凭证的话，每轮都会退回规则解析和模板问题（LLM=off 可以关掉这条提示）");
  }

  const seen = new Map<string, string>();
  for (const contact of contacts) {
    const platform = platformOf(contact.handle);
    if (!isValidHandle(contact.handle)) warnings.push(`通讯录里 ${contact.name} 的 "${contact.handle}" 不像号码或邮箱`);
    const other = seen.get(contact.handle);
    if (other) warnings.push(`通讯录里 ${other} 和 ${contact.name} 是同一个 handle（${contact.handle}）`);
    seen.set(contact.handle, contact.name);
    if (platform === "sim" && !has("sim")) warnings.push(`${contact.name} 在模拟器里（${contact.handle}），但 PROVIDERS 没启用 sim`);
    if (platform === "terminal" && !has("terminal")) warnings.push(`${contact.name} 在终端里（${contact.handle}），但 PROVIDERS 没启用 terminal`);
    if (platform === "imessage" && !has("imessage")) warnings.push(`${contact.name} 用的是 iMessage（${contact.handle}），但 PROVIDERS 没启用 imessage`);
  }

  if (config.mapsMode === "sample" && contacts.some((contact) => platformOf(contact.handle) === "imessage")) {
    warnings.push("MAPS_MODE=sample：只认几个虚构地标（library、north station、campus gate、town square），真人说别的地名会找不到");
  }
  if (config.quietHours) {
    warnings.push(`夜间免打扰 ${fmtTime(config.quietHours.start)}–${fmtTime(config.quietHours.end)}：这段时间发给别人的消息会推迟（QUIET_HOURS=off 关掉）`);
  }
  return { errors, warnings };
}
