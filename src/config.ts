export type ProviderName = "imessage" | "sim" | "terminal";
export type MapsMode = "sample" | "cache" | "live";

function oneOf<const T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}="${value}" 无效，可选：${allowed.join(", ")}`);
  }
  return value as T;
}

const env = Bun.env;
const port = Number(env.PORT || 3000);

export const config = {
  providers: (env.PROVIDERS || "sim")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => oneOf("PROVIDERS", name, ["imessage", "sim", "terminal"])),
  /** 设了以后，网页模拟器要带 ?key=... 才能用（服务暴露到公网时设）。 */
  simKey: env.SIM_KEY || undefined,
  port,
  publicBaseUrl: env.PUBLIC_BASE_URL || `http://localhost:${port}`,
  dbPath: env.DB_PATH || "data/app.db",
  timezone: env.EVENT_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  agentName: env.AGENT_NAME || "Juno",
  contactsPath: env.CONTACTS_PATH || "fixtures/contacts.json",

  debounceMs: Number(env.DEBOUNCE_MS || 3000),
  paceMs: Number(env.PACE_MS || 700),

  llm: env.LLM !== "off",
  model: env.CLAUDE_MODEL || "claude-opus-5",
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS || 8000),

  mapsMode: oneOf("MAPS_MODE", env.MAPS_MODE || "sample", ["sample", "cache", "live"]),
  mapsServerKey: env.MAPS_SERVER_KEY,
  mapsCacheDir: env.MAPS_CACHE_DIR || "fixtures/maps-cache",
  /** 地图搜索时附加的地区，比如 "St. Louis, MO"。 */
  mapsRegion: env.MAPS_REGION || undefined,

  emailDriver: env.EMAIL_DRIVER || "console",
  emailFrom: env.EMAIL_FROM || "Juno <juno@example.com>",
  outboxDir: env.OUTBOX_DIR || "data/outbox",
};
