// 清空数据库，载入示例活动（虚构数据），打印看板和个人页链接。
// 用法：bun run reset-demo [--stage collecting|ready|published]      只清空：bun run reset-demo --empty

import { config, loadContacts } from "../src/config";
import { seedDemo, type SeedStage } from "../src/demo/seed";
import { Store } from "../src/store/db";

const STAGES: SeedStage[] = ["collecting", "ready", "published"];
const args = process.argv.slice(2);
const store = new Store(config.dbPath);

if (args.includes("--empty")) {
  store.reset();
  console.log(`已清空 ${config.dbPath}`);
  process.exit(0);
}

const flag = args.indexOf("--stage");
const stage = (flag >= 0 ? args[flag + 1] : "collecting") as SeedStage;
if (!STAGES.includes(stage)) {
  console.error(`--stage 可选：${STAGES.join(", ")}`);
  process.exit(1);
}

const { event, links } = await seedDemo(store, {
  stage,
  contacts: loadContacts(config.contactsPath),
  now: new Date(),
  timezone: config.timezone,
  baseUrl: config.publicBaseUrl,
  emailFrom: config.emailFrom,
});

console.log(`已载入示例活动（${event.day}，${event.status}，v${event.inputVersion}）到 ${config.dbPath}`);
for (const { name, url } of links) console.log(`  ${name.padEnd(6)} ${url}`);
console.log("开发网页时把 3000 换成 5173（bun run web:dev）。");
