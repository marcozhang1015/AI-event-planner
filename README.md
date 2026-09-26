# AI Event Planner（Juno）

住在 iMessage 里的活动协调 agent，参加 Photon「Agents in iMessage」赛道。产品范围、demo 脚本和分工见 [hackathon-plan.md](hackathon-plan.md)。

## 快速开始

```bash
bun install
cp .env.example .env
cp fixtures/contacts.example.json fixtures/contacts.json
bun run demo
```

然后打开 <http://localhost:3000/sim>。

默认配置不需要任何账号：
- `PROVIDERS=sim`：网页模拟器；
- `MAPS_MODE=sample`：虚构地点；
- 邮件写进 `data/outbox/`；
- 没配 Claude 凭证时，每轮自动退回规则解析和模板问题。

## 网页模拟器（/sim）

暗色舞台上并排显示 5 部 iPhone，每部是一个人和 Juno 的私聊，界面仿 iMessage：
- 气泡、typing、链接卡片、confetti 特效；
- 点 Juno 的气泡可以回 tapback；
- 每个人头顶有一盏灯，Juno 正在给谁打字，那盏灯就亮。

它是用 Spectrum 的 `definePlatform` 写的自定义平台（`src/sim/`），和 iMessage 一样注册，消息汇进同一条消息流。所以 agent 的代码不区分对方是真手机还是模拟器。

- **试一遍**：在 Alex 的手机里点示例句子发出去，按提示回答。邀请 "sam and priya" 之后，他们的手机会收到开场白。
- **改开发**：`bun run dev`（后端，改了自动重启）加 `bun run web:dev`（前端热更新），打开 <http://localhost:5173/sim>。
- **谁在模拟器里**：通讯录里 handle 以 `sim:` 开头的人。
- **暴露到公网时**：设 `SIM_KEY`，模拟器就要带 `?key=...` 才能打开，免得别人冒充模拟的人。
- **对话记录**：模拟器里的只存在内存，重启服务就清空；agent 的数据在 SQLite 里。

## 接 iMessage（可以和模拟器并行）

1. 用 [debug.photon.codes](https://debug.photon.codes) 查出每部 demo 手机真实的 handle，登记到 Dashboard → Users。Pro 套餐只能给登记过的号码发消息。
2. `.env` 里填 `SPECTRUM_PROJECT_ID`、`SPECTRUM_PROJECT_SECRET`，设 `PROVIDERS=imessage,sim`。
3. `fixtures/contacts.json` 里把用真手机的人改成真实号码，其余保留 `sim:`。比如 Alex 用 iPhone，其他人在模拟器里，他们可以在同一场活动里互相邀请。

还需要终端界面的话，`PROVIDERS` 里加上 `terminal`，通讯录里用 `term:<窗口 id>`。

## 看板和个人页

```bash
bun run reset-demo   # 载入一个收集到一半的示例活动，打印看板和个人页链接
bun run demo         # 打开 http://localhost:3000/o/demo-alex
```

iMessage 和邮件里的链接指向 `PUBLIC_BASE_URL`，demo 时要配一个公网域名（plan §3.2）。

## Claude、地图、邮件

- **Claude**：设 `ANTHROPIC_API_KEY`，默认模型 `claude-opus-5`。`LLM=off` 时完全不调模型。
- **地图**：`MAPS_MODE=sample`（虚构数据）、`cache`（只读本机缓存）、`live`（请求 Google 并写缓存）。抓 demo 区域的数据：

  ```bash
  MAPS_MODE=live MAPS_REGION="Your City, ST" bun run fetch-maps "near campus" hike "the library"
  ```

  缓存在 `fixtures/maps-cache/`，不进 git（地图服务商限制缓存和存储数据）。
- **邮件**：`EMAIL_DRIVER=console` 把邮件写成 `data/outbox/*.eml`，可以直接用"邮件"App 打开预览。真实服务商 Day-0 定了再接（`src/out/email.ts`）。

## 测试

```bash
bun test
bun run typecheck
```

## 代码约定

- **flow 不直接写库、不直接发消息**：只通过 `ChangeSet` 改数据，并返回要发的 `Outbound`。管线确认这一轮没过期（处理期间没来新消息）才提交和发送（`src/flows/changes.ts`、`src/io/pipeline.ts`）。
- **事实性内容用模板**：摘要、方案、个人通知都由 `src/out/imessage.ts` 生成。Claude 只负责抽取字段和提问措辞，而且只有它问的正是代码算出的下一个字段时才用它的话。
- **只给有权看的数据**：网页 API、模板和 Claude 的上下文都经过 `src/core/privacy.ts`。
- **跨活动记忆**（`src/flows/memory.ts`）：只记本人确认过的偏好，下次只当提议，本人确认后才用；"forget me" 就删。时间和预算不记。
- **handle 前缀决定平台**：`sim:` 网页模拟器，`term:` 终端，其余是 iMessage 号码或邮箱（`src/io/transport.ts`）。
- **共享类型**：`src/types.ts` 由 B 维护；网页 API 的结构在 `src/api/dto.ts`，模拟器协议在 `src/sim/protocol.ts`，A 和 B 一起维护。
- **待办**：用 `TODO(负责人, 里程碑)` 标注，`grep -rn "TODO(" src web/src` 能列出来。

## 目录

```text
src/index.ts        启动 Spectrum 和 HTTP / WebSocket 服务
src/io/             Spectrum 接入、消息管线
src/sim/            网页模拟器：自定义 Spectrum 平台（sim provider）和 WebSocket 中转
src/flows/          组织者和参与者流程、ChangeSet、跨活动记忆
src/brain/          Claude 抽取、提示词、规则解析（LLM 的回退）
src/core/           状态机、批准检查、隐私投影、求解器（待实现）、时间工具
src/maps/           地图适配层：sample / cache / live
src/out/            iMessage 文案模板、邮件、ICS
src/api/            网页用的 JSON API 和页面
web/                看板、个人行程页、网页模拟器（Vite + React）
scripts/            reset-demo、fetch-maps
fixtures/           示例地图数据、通讯录模板
test/               bun test
```
