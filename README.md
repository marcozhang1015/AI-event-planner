# AI Event Planner（Juno）

住在 iMessage 里的活动协调 agent，参加 Photon「Agents in iMessage」赛道。产品范围、demo 脚本和分工见 [docs/hackathon-plan.md](docs/hackathon-plan.md)；上真机前的修复清单和核对记录见 [docs/fix_before_deploy.md](docs/fix_before_deploy.md)。

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

启动时打印的 `[preflight]` 会提示漏填或危险的配置。公网地址、启用 sim、却没设 `SIM_KEY` 时会拒绝启动。

## 完整流程（plan §4.3）

1. **发起**：组织者一句话发起，Juno 问缺的信息，发摘要确认（回 yes 或点 👍）。
2. **邀请**：给名单，比如 "sam, priya, leo, mia. I'm in too and can drive 2"，Juno 分别私聊每个人。组织者说自己也去时，在他自己的私聊里补问他的约束。
3. **收集**：每人答时间、过敏、开车、集合点、预算，然后确认摘要。所有人都确认后，或者组织者说 `plan it`，就出方案发给组织者：Plan A、Plan B、待核实项。
4. **核实与批准**：组织者打电话问过店家后说 "just called, they said they can do it"，再说 `approve A`，每个人才会收到自己的安排。有邮箱的人另收日历邀请。
5. **发布后变更**：有人改了答案，Juno 重新求解；要请 if_needed 的人开车时，先私聊征得本人同意。组织者 `approve` 之后，只通知受影响的人。

## 网页模拟器（/sim）

暗色舞台上并排显示 5 部 iPhone，每部是一个人和 Juno 的私聊，界面仿 iMessage：
- 气泡、typing、链接卡片、confetti 特效；
- 点 Juno 的气泡可以回 tapback；
- 每个人头顶有一盏灯，Juno 正在给谁打字，那盏灯就亮。

它是用 Spectrum 的 `definePlatform` 写的自定义平台（`src/io/simulator.ts`），和 iMessage 一样注册，消息汇进同一条消息流。所以 agent 的代码不区分对方是真手机还是模拟器。

- **试一遍**：在 Alex 的手机里点示例句子发出去，按提示回答。邀请 "sam and priya" 之后，他们的手机会收到开场白。
- **改开发**：`bun run dev`（后端，改了自动重启）加 `bun run web:dev`（前端热更新），打开 <http://localhost:5173/sim>。
- **谁在模拟器里**：通讯录里 handle 以 `sim:` 开头的人。
- **对话记录**：模拟器里的只存在内存，重启服务就清空；agent 的数据在 SQLite 里。

## 真机测试（iMessage，可以和模拟器并行）

1. 用 [debug.photon.codes](https://debug.photon.codes) 查出每部手机真实的 handle，登记到 Dashboard → Users。Pro 套餐只能给登记过的号码发消息；没登记的，Juno 会告诉组织者谁没收到、怎么重发（`invite Sam`）。
2. `.env` 里填 `SPECTRUM_PROJECT_ID`、`SPECTRUM_PROJECT_SECRET`，设 `PROVIDERS=imessage,sim`。
3. `fixtures/contacts.json` 里把用真手机的人改成真实号码，其余保留 `sim:`。号码怎么写都行（`(314) 555-0101` 会规范化成 `+13145550101`）。
4. 配一个公网域名（隧道或部署），设 `PUBLIC_BASE_URL` 和 `SIM_KEY`。手机上的看板和行程页链接要靠它打开。
5. 用 `bun run start` 启动，不要开 watch：进程停着时发来的消息不会补发。重启前已经收到、还没处理完的消息，启动时会补处理。
6. 每条收发的消息都会打一行日志（`[in]` / `[out]` / `[later]`），用来对照手机屏幕和 handle。
7. 群聊消息只记日志、不处理，所以私聊内容不会发进群里。
8. 晚 10 点到早 8 点，发给别人的消息会推迟到早上；demo 时设 `QUIET_HOURS=off`。

还需要终端界面的话，`PROVIDERS` 里加上 `terminal`，通讯录里用 `term:<窗口 id>`。

## 看板和个人页

```bash
bun run reset-demo                     # 收集到一半的示例活动，打印看板和个人页链接
bun run reset-demo --stage ready       # 全员已确认，组织者说 "plan it" 就出方案
bun run reset-demo --stage published   # Plan A 已发布，可以直接演幕 4
bun run demo                           # 打开 http://localhost:3000/o/demo-alex
```

种子数据按名字从通讯录找 handle（找不到就用 `sim:`），所以真手机也能进预置的活动。

- **看板** `/o/:token`：收集进度、方案（时间线、车组、待核实项、被排除的人和原因类别）、发布后的变更提议、每人收到通知没有。
- **行程页** `/i/:token`：本人的时间线、同车人和上车点、费用上界、改了什么，以及"加入日历"（`/i/:token/calendar.ics`）。
- **地图**：有 `MAPS_SERVER_KEY` 时，由服务端代理 Static Maps（`/map/:token.png`），key 不出服务端；没有 key 时网页画示意图。

## Claude、地图、邮件

- **Claude**：设 `ANTHROPIC_API_KEY`，默认模型 `claude-opus-5`。`LLM=off` 时完全不调模型。真机测试前先在模拟器里用 `LLM=on` 跑一遍，看看延迟。
- **地图**：`MAPS_MODE=sample`（虚构数据）、`cache`（只读本机缓存）、`live`（请求 Google 并写缓存）。抓 demo 区域的数据：

  ```bash
  MAPS_MODE=live MAPS_REGION="Your City, ST" bun run fetch-maps "near campus" hike "the library"
  ```

  缓存在 `fixtures/maps-cache/`，不进 git（地图服务商限制缓存和存储数据）。场地的价格和过敏事实（比如 `peanut: SUPPORTED`）要团队核实后写进缓存；价格未知的场地不会进方案。
- **邮件**：`EMAIL_DRIVER=console` 把邮件写成 `data/outbox/*.eml`，可以直接用"邮件"App 打开预览，附件里有日历邀请（固定 UID，更新时 SEQUENCE+1）。真实服务商 Day-0 定了再接（`src/out/email.ts`）。

## 测试

```bash
bun test
bun run typecheck
```

## 代码约定

- **flow 不直接写库、不直接发消息**：只通过 `ChangeSet` 读写数据，并返回要执行的出站动作 `Outbound`（消息、tapback、邮件，见 `src/out/actions.ts`）。出站动作是纯数据，可以存起来晚点发。
- **一轮就是一个乐观事务**：`ChangeSet.commit()` 会比对这一轮读过或要写的每一行。别的回合先改了，就抛 `StaleWriteError`，管线用新数据重跑这一轮；处理期间同一个人来了新消息，这一轮就作废，合并后重跑（`src/store/changes.ts`、`src/io/pipeline.ts`）。
- **出站统一走 outbox**：夜间免打扰、发送失败告诉组织者、送达记录都在 `src/io/outbox.ts`。
- **事实性内容用模板**：摘要、方案、变更提议、个人通知、邮件、日历，都由 `src/out/` 从隐私投影后的视图生成。Claude 只负责抽取字段和提问措辞，而且只有它问的正是代码算出的下一个字段时才用它的话（`nextQuestion()`）。批准、核实这类命令只认规则。
- **只给有权看的数据**：网页 API、模板、邮件、日历和 Claude 的上下文都经过 `src/out/privacy.ts`；每个人的网页链接也在这里生成。
- **方案绑定版本**：任何输入变化都 `bumpInput`，过期的方案不能被批准（`src/core/state.ts`）。求解器是纯函数、确定性（`src/core/solver.ts`）。
- **跨活动记忆**（`src/core/memory.ts`）：只记本人确认过的偏好，下次只当提议，本人确认后才用；"forget me" 就删。时间和预算不记。
- **handle 统一写法**：通讯录、入站发送者、联系人卡片都经过 `normalizeHandle()`。前缀决定平台：`sim:` 网页模拟器，`term:` 终端，其余是 iMessage 号码或邮箱（`src/core/handle.ts`）。
- **共享代码放 `src/shared/`**：领域类型 `types.ts` 由 B 维护；视图结构 `views.ts`（也是网页 API 的返回结构）和模拟器协议 `sim.ts` 由 A 和 B 一起维护。网页只通过 `@shared/*` 引用服务端代码；`shared/` 里的文件只能引用 `shared/` 里的其他文件，不能用 Bun / Node 的 API。
- **配置只在入口读**：`src/config.ts` 只由 `src/index.ts` 和 `scripts/` 读取，其他模块要用的配置由调用方传进去。
- **待办**：用 `TODO(负责人, 里程碑)` 标注，`grep -rn "TODO(" src web/src` 能列出来。

## 目录

```text
docs/               计划（hackathon-plan.md）、产品基线 PRD、上真机前的修复记录、赛道说明
src/
  index.ts          启动：配置检查 → 数据库、Claude、地图、邮件 → HTTP / WebSocket → Spectrum → 管线
  config.ts         环境变量、通讯录、启动检查（preflight）
  shared/           服务端和网页共用：领域类型、视图结构、模拟器协议、时间、文案用语
  core/             纯逻辑（不碰数据库和网络）：求解器、状态与批准检查、跨活动记忆、handle、过敏、距离
  store/            SQLite（db.ts）；一轮对话的乐观事务和常用查询（changes.ts）
  brain/            Claude 抽取、提示词、规则解析（LLM 的回退和命令）
  maps/             地图适配层：sample / cache / live、候选场地搜索、Google（含静态地图）
  out/              对外输出：隐私投影、出站动作、iMessage 文案、邮件、日历
  flows/            对话流程：入口（router）、组织者、参与者、邀请、约束收集、方案与发布
  io/               消息收发：Spectrum 接入、收消息管线、outbox、网页模拟器、消息日志
  api/              网页：JSON API、页面、日历下载、静态地图代理
  demo/             种子数据（reset-demo 用）
web/src/
  pages/            看板（/o/:token）、行程页（/i/:token），以及它们的样式和轮询
  components/       页面组件；map/ 是示意地图
  sim/              网页模拟器（/sim）
scripts/            reset-demo、fetch-maps
fixtures/           示例地图数据、通讯录模板
test/               bun test（harness.ts 是测试工具）
```

依赖只往一个方向走：每一层只引用它右边的层，反过来不行。`config.ts` 只有入口读取，`maps/`、`io/` 只引用它的类型。

```text
index.ts → io / api / demo → flows → out → store / brain / maps → core → shared
```
