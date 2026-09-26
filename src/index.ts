import { createApi } from "./api/routes";
import { createBrain } from "./brain/extract";
import { config } from "./config";
import { Store } from "./db";
import { loadContacts } from "./flows/contacts";
import { handleTurn } from "./flows/router";
import { Pipeline } from "./io/pipeline";
import { Transport } from "./io/transport";
import { createMaps } from "./maps";
import { SimHub, type SimSocket } from "./sim/hub";

const store = new Store(config.dbPath);
const brain = createBrain();
const maps = createMaps();
const contacts = loadContacts(config.contactsPath);

// 网页模拟器里的人：通讯录里 handle 以 sim: 开头的都是
const simHub = config.providers.includes("sim")
  ? new SimHub(contacts.filter((contact) => contact.handle.startsWith("sim:")).map((contact) => ({ id: contact.handle.slice("sim:".length), name: contact.name })))
  : undefined;

const api = createApi(store);
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

const pipeline = new Pipeline({
  store,
  transport,
  debounceMs: config.debounceMs,
  paceMs: config.paceMs,
  handle: (db, turn) =>
    handleTurn(
      {
        db,
        brain,
        maps,
        contacts,
        now: new Date(),
        timezone: config.timezone,
        baseUrl: config.publicBaseUrl,
        agentName: config.agentName,
        mapsRegion: config.mapsRegion,
      },
      turn,
    ),
});

async function shutdown() {
  await transport.stop();
  await server.stop();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

for await (const [space, message] of transport.app.messages) {
  pipeline.enqueue(space, message);
}
