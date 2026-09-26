// 启动：配置检查 → 数据库、Claude、地图、邮件 → HTTP / WebSocket 服务 → Spectrum → 消息管线。
// 配置只在这里（和 scripts/）读，其他模块需要什么都由这里传进去。

import { createApi } from "./api/routes";
import { claudeBrain, offlineBrain } from "./brain/extract";
import { config, loadContacts, preflight } from "./config";
import { platformOf } from "./core/handle";
import { handleTurn } from "./flows/router";
import { Pipeline } from "./io/pipeline";
import { SimHub, type SimSocket } from "./io/simulator";
import { Transport } from "./io/transport";
import { createMaps } from "./maps";
import { createEmailSender } from "./out/email";
import { Store } from "./store/db";

const contacts = loadContacts(config.contactsPath);
const checks = preflight(config, contacts);
for (const warning of checks.warnings) console.warn(`[preflight] ${warning}`);
if (checks.errors.length) {
  for (const error of checks.errors) console.error(`[preflight] ${error}`);
  process.exit(1);
}

const store = new Store(config.dbPath);
const brain = config.llm ? claudeBrain({ model: config.model, timeoutMs: config.llmTimeoutMs }) : offlineBrain;
const maps = createMaps(config);
const email = createEmailSender(config.emailDriver, config.outboxDir, config.emailFrom);
/** 网页链接、邮件和日历都要用的站点信息。 */
const site = { baseUrl: config.publicBaseUrl, agentName: config.agentName, emailFrom: config.emailFrom };

// 网页模拟器里的人：通讯录里 handle 以 sim: 开头的都是
const simHub = config.providers.includes("sim")
  ? new SimHub(contacts.filter((contact) => platformOf(contact.handle) === "sim").map((contact) => ({ id: contact.handle.slice("sim:".length), name: contact.name })))
  : undefined;

const api = createApi(store, { ...site, mapsServerKey: config.mapsServerKey });
const server = Bun.serve<undefined>({
  port: config.port,
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === "/sim/ws") {
      if (!simHub) return new Response("sim provider 没有启用（PROVIDERS 里加上 sim）", { status: 404 });
      if (config.simKey && url.searchParams.get("key") !== config.simKey) return new Response("forbidden", { status: 403 });
      return bunServer.upgrade(request) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }
    return api.fetch(request);
  },
  websocket: {
    open: (socket) => simHub?.attach(socket as SimSocket),
    message: (_socket, data) => simHub?.receive(String(data)),
    close: (socket) => simHub?.detach(socket as SimSocket),
  },
});

// 启用 terminal 时，console 输出会进 TUI 左侧的 __system__ 聊天
const transport = await Transport.start(config.providers, simHub);
console.log(
  `[juno] providers=${config.providers.join(",")} llm=${config.llm ? config.model : "off"} maps=${config.mapsMode} web=${config.publicBaseUrl} (local ${server.url})`,
);
if (simHub) console.log(`[juno] 模拟器：${server.url}sim${config.simKey ? `?key=${config.simKey}` : ""}（${simHub.people.map((person) => person.name).join("、") || "通讯录里没有 sim: 开头的人"}）`);

// 每一轮的依赖：db 和 now 每轮新建，其余不变
const flowDeps = {
  ...site,
  brain,
  maps,
  contacts,
  timezone: config.timezone,
  mapsRegion: config.mapsRegion,
  quietHours: config.quietHours,
  mapImages: Boolean(config.mapsServerKey),
};
const pipeline = new Pipeline({
  store,
  transport,
  email,
  debounceMs: config.debounceMs,
  paceMs: config.paceMs,
  timezone: config.timezone,
  quietHours: config.quietHours,
  logMessages: config.logMessages,
  handle: (db, turn) => handleTurn({ ...flowDeps, db, now: new Date() }, turn),
});
pipeline.start();

async function shutdown() {
  await pipeline.stop();
  await transport.stop();
  await server.stop();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

for await (const [space, message] of transport.app.messages) {
  pipeline.enqueue(space, message);
}
