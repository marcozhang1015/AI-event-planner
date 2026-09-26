# 上真机前的修复清单

来源：2026-09-26 的全项目检查。第一组是上真机前必须修的，第二组建议一起修，第三组是幕 3–4 还没做的功能。

这份文件既是改动说明，也是验收表。每一项写了问题、改法和验收方式，做完后在第五节"核对记录"里填上结果。

> 注：之后整理过一次目录，这里记录的是当时的路径。其中 `src/preflight.ts` 并进了 `src/config.ts`，`src/out/labels.ts` 移到了 `src/shared/labels.ts`，其余提到的文件路径不变。现在的目录见 README 的「目录」一节。

## 一、上真机前必须修

### 1.1 发送失败要告诉组织者，并且能重发

- **问题**：共享号码池下 `space.create()` 不经过服务器，号码没登记要到发送时才报 `Target not allowed`，管线只打一行日志（`src/io/pipeline.ts` 的 TODO）。这时组织者已经收到 "Texting Sam now"，看板上 Sam 也显示在等回复。再说一次 "sam" 会因为 Sam 已是成员而被跳过，只回 "Noted."。
- **改法**：
  - 发给别人的消息带上"失败时告诉谁、怎么称呼收件人、怎么重试"。管线发完一批后，把失败的人合成一条消息告诉组织者，邀请失败会提示 `invite Sam`。
  - 方案通知写进送达记录（`deliveries` 表），看板显示每个人收到没有。
  - 再邀请一个还没回复过的人（状态 invited）时，重发开场白。
- **验收**：管线测试"发给别人失败 → 组织者收到一条说明，失败的人记进送达记录"；流程测试"再邀请还没回复的人 → 重发开场白"。

### 1.2 群聊消息不处理

- **问题**：Spectrum 给了 `space.type`（dm / group），我们没用。管线把收到消息的会话记成这个人的会话，于是 Sam 在群里说过一句话以后，发给他的摘要（过敏、预算）会发进那个群。Day-0 第 1 项正好要把 agent 拉进群测试。
- **改法**：transport 识别群会话：只记一行日志（每个群一次），不进管线，也不把群会话记成任何人的会话。
- **验收**：管线测试"群消息不触发回合，之后发给这个人的消息仍走私聊"。

### 1.3 handle 规范化和消息日志

- **问题**：通讯录不做规范化，写成 `(314) 555-0101` 就和回复里的 `+13145550101` 对不上：对方的回复被当成陌生人，开场白里组织者的名字也变成 "a friend"。另外代码不记每条消息，走 iMessage 时除了手机屏幕看不到对话。
- **改法**：
  - 新增 `normalizeHandle()`，号码转成 E.164，邮箱转小写，`sim:` / `term:` 原样保留。通讯录、入站发送者、联系人卡片都先过它。
  - 通讯录里有重复的 handle 或无效的写法时，启动检查会提示。
  - 管线每收发一条消息打一行日志（handle、类型、前 80 个字），用 `LOG_MESSAGES=off` 关掉。
- **验收**：单元测试覆盖号码和邮箱规范化；流程测试"通讯录写成 `(555) 000-0002` 也能对上回复"。

### 1.4 重启不丢消息

- **问题**：SDK 的消息游标只存在内存里，进程停着时发来的消息重启后不会补发。已经入库、还没处理完的消息，要等这个人再发一条才会处理，因为启动时不扫待处理表。`bun run dev` 每次保存都会重启。
- **改法**：
  - 管线启动时扫一遍待处理表，每个有未处理消息的人补一轮。
  - 一轮的数据提交和"消息已处理"标记放进同一个事务，避免提交了却没标记，重启后又处理一遍。
  - README 写明：真机测试用 `bun run start`，别开 watch。
- **验收**：管线测试"库里有待处理消息 → `start()` 之后自动处理并回复"。

### 1.5 环境与启动检查

- **问题**：`.env` 还没建；发到手机上的 localhost 链接打不开；开了隧道却没设 `SIM_KEY` 时，任何人都能通过 `/sim/ws` 冒充模拟器里的人。
- **改法**：新增启动检查（`src/preflight.ts`），启动时打印结果：
  - 错误（拒绝启动）：`PUBLIC_BASE_URL` 是公网地址、启用了 sim 却没设 `SIM_KEY`。
  - 警告：
    - 启用 imessage，但 `PUBLIC_BASE_URL` 还是 localhost
    - 没有 Claude 凭证
    - 通讯录里有 `sim:` / 手机号，但对应的 provider 没启用
    - 通讯录里有无效或重复的 handle
    - `MAPS_MODE=sample` 时接了真人（sample 只认几个虚构地标）
    - 夜间免打扰开着
  - `.env.example` 补上新增的配置项。`.env` 里的凭证和隧道域名要团队自己填。
- **验收**：启动检查的单元测试覆盖上面每一条。

## 二、建议一起修

### 2.1 收集阶段的邀请识别

- **问题**：收集阶段只要提到通讯录里的名字就走邀请，还把句子里的普通词当成不认识的名字。"has sam answered yet?" 会回 "Noted. I don't have a number for Has, Answered and Yet yet"；"just sam for now" 会把 Just、For、Now 当成人名。
- **改法**：
  - 等组织者给名单时，整条消息都当名单。其他时候，要有邀请的说法（invite / add / also ask / text…）或联系人卡片，才算邀请。
  - "不认识的名字"只从名单里找：按逗号、and、& 切开，1–2 个词、不在停用词表里的一项才算人名；提到通讯录里的名字就直接对上。
- **验收**：流程测试覆盖检查时复现的 5 句话，以及 "also invite bob" 会问 Bob 的号码。

### 2.2 确认之后的提问

- **问题**：参与者确认之后问 "where are we going for dinner?"，只收到一个 ❤️。Claude 返回的 question / smalltalk 意图没有任何处理。
- **改法**：参与者确认之后发来的消息，如果是提问（Claude 判成 question，或者规则上以问号结尾、以疑问词开头）：
  - 方案已发布：把他自己的安排再发一遍，附行程页链接；
  - 还没发布：回 "Nothing's locked in yet — I'll text you as soon as Alex approves the plan."。
  - "thanks"、"ok" 这类仍然只点 tapback。
- **验收**：流程测试覆盖发布前和发布后的提问，以及 "thanks!" 仍然只点 tapback。

### 2.3 集合点找不到或有歧义

- **问题**：sample 地图只认几个词，真人说了别的地名就一直收到 "I couldn't find…"，说 skip 也出不来。live 模式只取第一个结果，可能落到别的城市。
- **改法**：
  - 离活动区域中心超过 `max(2 × 半径, 10 km)` 的结果丢掉。
  - 查询只有一个词（"library"），又找到多个地点时，列出前 3 个让本人回编号。
  - 连续两次找不到时，列出这场活动里其他人已经确认的集合点让他选，也可以换个地标再说。
- **验收**：流程测试覆盖"找不到两次 → 列出候选 → 回 1 选中"和"有歧义 → 列出候选"。

### 2.4 并发回合互相覆盖

- **问题**：两个人的回合同时跑时，各自拿着旧的 Event 整个写回。组织者改成的 REVIEW 会被参与者那一轮改回 COLLECTING，版本号也会少加一次，过期的方案因此能通过批准检查。
- **改法**：ChangeSet 改成乐观事务：
  - 记下这一轮读到或第一次写到的每一行；提交时在事务里比对，有任何一行被别人改过，就抛 `StaleWriteError`。
  - 管线收到这个错误，就用新数据重跑这一轮（最多 3 次），这一轮的消息不会发出去。
  - 地点、场地这类参考数据是幂等写入，不比对。
- **验收**：ChangeSet 测试"别人先改了同一行 → 提交失败"；管线测试"冲突后重跑，只回复一次，状态不丢"。

### 2.5 typing 出错不影响整轮

- **问题**：SDK 的 `responding()` 在 try 外面发 typing start。它一报错，这一轮就只回一句 "Sorry — something went wrong"，原消息也被标成已处理。
- **改法**：transport 提供 `typing(handle, on)`，管线自己开关 typing，出错只记日志。
- **验收**：管线测试"typing 抛错 → 这一轮照常处理并回复"。

### 2.6 对开场白说 "not now"

- **问题**：对开场白回 "not now" 会继续提问。
- **改法**：not now、later、busy、in a bit、can't right now 这类回复都算"晚点再说"。
- **验收**：流程测试"not now → 回 No worries…，不提问"。

### 2.7 SMS / RCS 发纯文本

- **问题**：`sender.service` 是 SMS 或 RCS 的人仍然会收到链接卡片和特效（`src/io/transport.ts` 的 TODO）。
- **改法**：transport 记下每个人的 service。SMS / RCS 的人收纯文本，链接直接写成网址。
- **验收**：transport 测试"SMS 用户 → 链接和庆祝消息都发纯文本"。

### 2.8 夜间免打扰

- **问题**：plan §4.4 第 7 条规定晚 10 点到早 8 点不主动发消息，现在没做。
- **改法**：
  - `QUIET_HOURS=22-8`（默认）或 `off`，按活动时区算。
  - 免打扰时段里，发给别人的消息存进 `scheduled` 表，到点由管线的定时器发出。回复当前说话的人不受影响。
  - 组织者的操作（邀请、批准）碰到免打扰时，回复里说明几点发出。
- **验收**：outbox 测试"免打扰时段 → 发给别人的消息存起来，到 8 点才发"；流程测试"深夜邀请 → 组织者收到 I'll text them at 8 AM"。

## 三、幕 3–4 的功能

整体数据流：确认答案或组织者改设置 → `inputVersion + 1` → 重新求解，生成新方案（绑定版本号） → 看状态决定发给谁：

| 情况 | 发给谁、发什么 |
|---|---|
| 最好的方案用到了还没答应的 if_needed 司机 | 先私聊问司机 |
| 还没发布 | 把方案发给组织者 |
| 已发布，方案有变化 | 把变更提议发给组织者 |

组织者 `approve` 之后才会发出最终安排或更新，iMessage 和邮件都一样。

### 3.1 组织者也作为参与者

- **问题**："sam, priya, leo, mia. I'm in too and can drive 2" 里的 "I'm in too and can drive 2" 被忽略（`src/flows/organizer.ts` 的 TODO）。组织者的约束从来没收集，demo 要用 Alex 的车。
- **改法**：
  - 邀请消息里识别"我也去"（I'm in / me too / count me in，或者人数刚好是受邀人数 + 1），以及开车和座位数。没说清楚时问一句 "Are you coming too?"。
  - 组织者去的话，给他建一份答案。空闲时间预填活动时间窗，预算预填组织者定的上限，有记忆的话也预填。
  - 组织者私聊里：先认命令（批准、核实、plan it、邀请、改设置），其余消息都当成补答自己的约束。问题、摘要、确认和参与者走同一套代码（`src/flows/collect.ts`）。
  - 进度按参与的人算：受邀的人，加上报名参加的组织者。
- **验收**：流程测试"I'm in too and can drive 2 → 组织者答案里有开车和 2 个座位，接着问过敏和出发地点，确认后计入 N of M"。

### 3.2 车程矩阵

- **问题**：只有 fetch-maps 脚本调用 `travelMinutes`，流程里从没算过车程。
- **改法**：
  - 求解前取所有相关地点（参与者的集合点、候选活动地点、餐厅），一次请求车程矩阵。缓存由地图层负责（sample 现算，cache / live 读写 `fixtures/maps-cache/`）。
  - 同一地点之间算 0 分钟；拿不到的组合是"未知"，不会当成 0。
  - 删掉没用的 `travel_times` 表。
- **验收**：求解器测试"车程缺失的组合不会被当成 0 分钟"。

### 3.3 求解器

- **改法**：按 plan §5.10 实现 `src/core/solver.ts`（纯函数，确定性）：
  - **枚举**：候选活动 × 餐厅 × 开始时间（时间窗内每 30 分钟一个）。时间线是接人 → 活动 → 晚餐 → 送回；每段车程加 10 分钟缓冲，同一地点之间不加。活动没写时长按 120 分钟算，晚餐按 90 分钟。
  - **逐人检查**：
    - 活动 + 晚餐的最高价不超过 min(本人预算, 组织者上限)；价格未知的场地不用；
    - 餐厅对他的过敏是 UNSUPPORTED 就排除他；是 UNKNOWN 就把方案标成待核实，不算通过；
    - 接人时间不早于他有空的时间，送到家不晚于他有空的时间和最晚到家时间；
    - 最早出发和最晚送到家都在活动时间窗内。
  - **分车**：
    - 司机：yes 的人都开车；答应过的 if_needed 当 yes，拒绝过的当乘客，没问过的是可选司机，不开车时也当乘客。
    - 乘客：不开车的人。
    - 枚举"排除谁（从 0 个开始）× 用哪些可选司机（从少到多）× 乘客怎么分到各辆车"。每辆车的接人顺序和送人顺序都枚举，取可行的里面最快的。座位不超，每个乘客恰好一辆车，往返同一车组。
  - **排序**（字典序）：参加人数多 → 用到的 if_needed 司机少 → 待核实项少 → 最大绕路少 → 总车程少 → 费用低 → 开始时间早 → 场地 id。"待核实项少"是在 plan 基础上加的一条：同样多人时，优先不用打电话核实的方案。
  - **输出**：
    - Plan A 是最好的方案；Plan B 是和 A 地点不同、不用核实的最好方案，没有就不给。
    - 都不可行时，给出最主要的冲突和可以改的方向，不写个人预算数字。
    - 人数上限 8 人，另有搜索次数上限，保证有结果返回。
- **验收**：`test/solver.test.ts` 里原来的 10 条 todo 全部改成真测试，包括 demo 场景（Plan A = Pine Ridge + Maple Kitchen 5/5 待核实，Plan B = Olive Tree，Leo 因预算被排除）。

### 3.4 方案消息与修改后重算

- **改法**：
  - 进入 REVIEW 的两种方式：组织者说 `plan it`（还没回复的人记为 no_answer），或者所有参与者都确认了。然后求解，把方案发给组织者，分三条消息：方案文字 → 看板链接 → "Reply approve A…"。
  - 方案文字包括接人时间、车组、活动、晚餐、送到家时间、⚠️ 待核实项（带餐厅电话）、被排除的人和原因类别，以及 Plan B。只给聚合信息，不写个人预算数字，不写谁过敏。
  - REVIEW 或 PUBLISHED 状态下，有人确认了新答案就重新求解。
  - 组织者用自然语言改设置（"can we start at 4?"）：先用 Claude 抽取，没有 Claude 时用规则解析，但要有 change / move / start at 这类说法才算修改。版本号 +1，重新求解并发新方案，旧方案作废。
- **验收**：流程测试"plan it → 方案消息内容正确，参与者什么都没收到"；"can we start at 4? → 新方案版本号更大，从 4 点开始"。

### 3.5 核实 UNKNOWN

- **改法**：组织者说 "just called, they said they can do it"（called / checked / spoke 加上肯定或否定的说法），就把 Plan A 的待核实项记成 SUPPORTED 或 UNSUPPORTED，并记下核实人、时间和"电话核实"。然后版本号 +1，重新求解：
  - A 没变、现在可以批准了，就回 "Noted — confirmed by you by phone at 7:12 PM. Plan A is ready…"；
  - 否则回 "Noted." 加新方案。
- **验收**：流程测试"核实后 A 变成可批准；核实为不行时，Maple Kitchen 不再出现在 Sam 参加的方案里"。

### 3.6 批准与发布

- **改法**：
  - 只认组织者发的明确文字（`approve A` / `approve B`，只有一个选项或是发布后的更新时可以只说 `approve`）。
  - 检查依次是：方案版本是当前版本 → 选项存在 → 没有待核实项 → 没有在等司机答复。每种失败都有对应的回复；方案过期时直接发最新方案。
  - 通过后：状态变成 PUBLISHED，记下已发布的方案和上一次发布的方案，发布次数 +1（就是日历邀请的 SEQUENCE），然后发个人通知。
- **验收**：流程测试"未经 approve 不会发出任何最终安排（iMessage 和邮件都算）"，以及过期、待核实、选项不明确这几种情况的回复。

### 3.7 个人通知

- **改法**：
  - **首次发布**：每人收到带 confetti 的 "You're all set for Saturday 🎉"。乘客看到谁几点在哪接；司机看到接人路线；都有活动、晚餐（组织者核实过的过敏会注明）、费用上界和送到家时间，然后是行程页链接。组织者如果参加，也收到自己的这份。
  - **被排除的人**：私聊一条友好的说明，只提他自己的原因。
  - 每条通知都写送达记录，失败了告诉组织者。
- **验收**：流程测试覆盖乘客和司机的通知内容、confetti、链接，以及被排除的人收到的说明。

### 3.8 邮件 + 日历邀请

- **改法**：
  - 留了邮箱的人，发布时收到个性化邮件：要点、行程页链接，有 key 时附静态地图。
  - 附 METHOD:REQUEST 的 ICS。UID 每人每场活动固定（handle 取哈希，不暴露号码），SEQUENCE = 发布次数 − 1。更新时只发给受影响的人，SEQUENCE 随之变大。
  - 行程页的"加入日历"下载同一 UID 的 PUBLISH 版本。
  - 发送走管线（`Email` 类型的出站动作），失败了告诉组织者。邮件服务商仍是 Day-0 决定，默认写进 `data/outbox/*.eml`。
- **验收**：流程测试"发布 → 有邮箱的人收到带 REQUEST ICS 的邮件；更新 → UID 不变、SEQUENCE +1"；API 测试"calendar.ics 下载"。

### 3.9 发布后变更（幕 4）

- **改法**：
  1. **有人改了答案**：发布后本人改答案（比如 "my car's in the shop, can't drive"），先请本人确认。原来开车、现在不开的情况用专门的说法："Thanks for the heads-up. Still want to come? I can get you picked up near North Station."。
  2. **本人确认之后**：重新求解。新方案需要 if_needed 司机时，先私聊征得他同意，并说明要带谁、多绕几分钟。同意了记 `agreedToDrive`，不同意也记下，然后都会重新求解。
  3. **提议变更**：拿新方案和已发布的方案比，找出个人安排有变化的人，给组织者发变更提议："Change for Saturday: Priya isn't driving anymore; Leo drives Sam and Priya. Everything else stays the same — you and Mia aren't affected. Reply "approve"…"。
  4. **组织者批准之后**：只给受影响的人发更新（iMessage + 邮件，ICS 的 SEQUENCE +1），行程页标出 Updated 和改了什么。
- **验收**：流程测试走完整个幕 4，只有 Sam、Priya、Leo 收到更新，Alex 和 Mia 什么都没收到，版本号从 v1 变成 v2。

### 3.10 看板方案视图、个人行程页、OG 图

- **改法**：
  - **API**：
    - `/api/o/:token` 在原有进度之外，加上方案视图：选项、时间线、车组、待核实项、被排除的人、版本号、已发布还是待批准的更新、每人收到通知没有；组织者参加的话，还有他自己的行程。
    - `/api/i/:token` 发布后返回个人行程（自己的路线、同车人的名字和上车点、费用上界、改了什么）。
    - `/o|i/:token/calendar.ics` 下载日历。
  - **地图**：
    - 有 `MAPS_SERVER_KEY` 时，服务端代理 Static Maps，路径是 `/map/:token.png`，不把 key 暴露给浏览器。
    - 没有 key，或者图片加载失败时，网页画 SVG 示意图（集合点、场地和接人路线）。
  - **OG**：链接预览有 og:title 和 og:description；有 key 时加 og:image，只画场地，不含任何个人信息。
  - **页面**：看板适合大屏，行程页以手机为主。每 2.5 秒轮询。
- **验收**：API 测试"组织者视图里没有预算数字和谁过敏；行程页只有本人和同车人的信息"；在浏览器里实际打开看板和行程页核对。

### 3.11 真机彩排用的种子数据

- **问题**：`reset-demo` 写死了 `sim:` handle，真手机进不了预置活动。
- **改法**：
  - 种子逻辑移到 `src/demo/seed.ts`，按名字从通讯录查 handle，查不到时才用 `sim:`。
  - 支持 `--stage collecting|ready|published`：收集到一半；全员已确认，等组织者说 plan it；已发布，可以直接演幕 4。
- **验收**：测试 3 个阶段都能载入；published 阶段的方案可以直接演幕 4。

## 四、不在代码里的事（Day-0 决定）

- Spectrum：凭证，每部 demo 手机在 Dashboard → Users 登记（用 debug.photon.codes 查真实 handle），agent 的名字和头像。
- 公网域名：隧道或部署，然后设 `PUBLIC_BASE_URL` 和 `SIM_KEY`。
- Google Maps：
  - 建项目、绑结算账户、开通 Places / Routes / Static Maps，设 `MAPS_SERVER_KEY`；
  - 用 `bun run fetch-maps` 抓 demo 区域，演示时用 `MAPS_MODE=cache`；
  - 场地的价格和过敏事实由团队按公开信息或电话核实后，写进缓存文件。
- 邮件服务商：选定并验证发信域名，然后在 `src/out/email.ts` 加一个 driver。
- Claude：在模拟器里用 `LLM=on` 实测延迟（Day-0 第 5 项）。

## 五、核对记录

核对时间 2026-09-26。`bun test` 126 个测试全部通过（14 个文件），`bun run typecheck` 和 `bun run web:build` 通过。

| 项 | 结果 | 核对方式 |
|---|---|---|
| 1.1 发送失败告诉组织者、能重发 | ✅ | `pipeline.test` "发给别人失败…"（组织者收到带 `invite Sam` 的说明，送达记录记下错误）；`flows.test` "再邀请还没回复的人…"、"按名字邀请…"（开场白带 onFail） |
| 1.2 群聊不处理 | ✅ | `pipeline.test` "群聊消息不处理，之后的私聊照常"；`transport.test` "私聊：…群聊…不处理" |
| 1.3 handle 规范化、消息日志 | ✅ | `core.test` "handle"；`flows.test` "通讯录的写法不统一也能对上"；日志见 `src/io/log.ts`（`[in]` / `[out]` / `[later]`，`LOG_MESSAGES=off` 关闭） |
| 1.4 重启不丢消息 | ✅ | `pipeline.test` "重启后补处理没处理完的消息"；`changes.test` "commit 的回调和写入在同一个事务里"；`pipeline.stop()` 会等正在跑的回合收尾 |
| 1.5 启动检查 | ✅ | `preflight.test` 三条；`.env.example` 已补 `QUIET_HOURS`、`LOG_MESSAGES`，删掉用不上的 `MAPS_BROWSER_KEY` |
| 2.1 邀请识别 | ✅ | `flows.test` "通讯录里没有的名字会问号码…"、"收集阶段随口问的话不会被当成邀请" |
| 2.2 确认后的提问 | ✅ | `flows.test` "确认后说 thanks…提问…"（发布前）；`planning.test` "发布之后提问：把本人的安排再发一遍" |
| 2.3 集合点找不到 / 有歧义 | ✅ | `flows.test` "地图上找不到集合点…"、"只有一个词、找到好几个地方…离活动太远的结果不要" |
| 2.4 并发回合互相覆盖 | ✅ | `changes.test` 五条；`pipeline.test` "提交时发现别的回合先改了同一行…" |
| 2.5 typing 出错 | ✅ | `pipeline.test` "typing 出错不影响这一轮" |
| 2.6 not now | ✅ | `flows.test` "对开场白说 not now…"；`parse.test` "晚点再说、提问" |
| 2.7 SMS / RCS 纯文本 | ✅ | `transport.test` "SMS / RCS 和 terminal 发纯文本…" |
| 2.8 夜间免打扰 | ✅ | `outbox.test` 两条；`flows.test` "深夜邀请：告诉组织者几点发出" |
| 3.1 组织者也参加 | ✅ | `flows.test` "按名字邀请…"、"组织者补答自己的约束…"、"没说自己去不去：问一句" |
| 3.2 车程矩阵 | ✅ | `solver.test` "车程缺失的组合不会被当成 0 分钟"；`travel_times` 表已删 |
| 3.3 求解器 | ✅ | `solver.test` 11 条（原 10 条 todo 全部改成真测试，另加"没有可行方案时说明主要冲突"），每条都用 `expectValid` 检查全部硬约束 |
| 3.4 方案消息、修改后重算 | ✅ | `planning.test` "最后一个人确认 → 方案发给组织者…"、"组织者改设置（can we start at 4?）…"、"plan it…" |
| 3.5 核实 UNKNOWN | ✅ | `planning.test` "核实之后 Plan A 可以批准…"、"核实结果是不行…" |
| 3.6 批准与发布 | ✅ | `planning.test` "未经 approve 不会发出任何最终安排"、"批准检查"；`core.test` "状态与批准" |
| 3.7 个人通知 | ✅ | `planning.test` "approve A → 发布；每人收到自己的安排…"、"approve B：…被排除的人收到一条说明" |
| 3.8 邮件 + 日历邀请 | ✅ | `planning.test` "留了邮箱的人收到个性化邮件…"、幕 4 "SEQUENCE +1"；`api.test` "加入日历…同一个 UID"；`core.test` "UID 每人每场活动固定，不含号码" |
| 3.9 发布后变更（幕 4） | ✅ | `planning.test` "幕 4：发布后司机退出" 七条（只有 3 个受影响的人收到更新，版本号变大，等司机答复期间不重复问，不再需要的请求会作废） |
| 3.10 看板、行程页、OG 图 | ✅ | `api.test` 六条（隐私投影、日历下载、OG、地图画什么）；浏览器核对见下 |
| 3.11 彩排种子数据 | ✅ | `seed.test` 三条；`DB_PATH=<临时库> bun run reset-demo --stage collecting|ready|published` 实跑通过，`--stage nope` 报错退出 |

实现中和清单不同的地方：
- 地图不用浏览器 key，改由服务端代理 Static Maps，key 不出服务端；链接预览的 og:image 也走这个代理。
- 开场白从 "4 quick questions" 改成 "a few quick questions"：开车的人要答 6 个问题。
- 规则解析保留"严重"：`peanuts, pretty severe` 记为 `peanuts (severe)`，方案里才写得出 "a severe peanut allergy"。
- 接送时间取整到 5 分钟（接人往前取、送到往后取），晚餐时间取整到一刻钟，保证只会早到。

### 浏览器核对（3.10）

用 published 阶段的种子数据，在临时数据库里走到"幕 4 变更等批准"，起一个 3100 端口的服务（`PROVIDERS=sim`、`LLM=off`）核对：

- **看板（1920×1080，深色和浅色）**：
  - 变更提议显示"改了什么"、受影响的人（Leo、Mia、Priya）和不受影响的人（You、Sam），状态是 v3、等待批准；
  - 只列 Plan A（变更只批准 A）；两辆车的路线画在示意地图上；
  - 没有控制台报错，也没有失败的请求。
- **在模拟器里以 Alex 回 "approve"**：
  - Alex 收到 "Update sent to the 3 people affected."；
  - Leo、Mia、Priya 收到更新和行程页链接卡片，Sam 什么都没收到；
  - 看板上三个人显示 Plan sent。
- **行程页（375×812）**：
  - Sam（乘客）：几点谁在哪接、组织者核实过的花生过敏说明、送回时间、同车的人；
  - Leo（司机）：Updated 横幅（You're driving now），接人和送人顺序；
  - "Add to calendar" 下载到 METHOD:PUBLISH 的 ICS，UID 固定，时间换算正确（3:05 PM CDT = 20:05Z）。

## 六、代码质量检查（production-level inspection）

修完之后做了两轮高强度审查：后端（`src/`、`test/`、`scripts/`）和网页（`web/`），每轮从 8 个角度查（逐行、删掉的行为、跨文件调用、复用、简化、效率、修在哪一层、约定）。发现的问题全部修掉并补了测试：

| 问题 | 改法 |
|---|---|
| 请 if_needed 的人开车后，新方案不再需要他，他的会话还停在"等答复" | 每次出方案时，把不再需要的开车请求作废 |
| 确认了却没有集合点的人会从方案里消失 | 计入 no_answer，在方案里写明 |
| 缺地点时落在 (0,0)，地图被拉到全世界 | 落在活动区域中心 |
| 同名的两个人在变更说明、看板里分不清 | 视图里给同名的人加编号（"Sam"、"Sam 2"） |
| `http://[::1]` 被当成公网地址，拒绝启动 | 修正 IPv6 本机地址的判断 |
| "Still want to come?" 回 "no, I'll find my own ride" 被当成不来了 | 只认明确的不来（`isDecline`） |
| 管线测试靠固定 sleep，负载高时会偶发失败 | 管线加 `drain()`；`stop()` 会等正在跑的回合收尾，关机不丢一半 |
| 链接预览测试在没 build 时直接跳过 | 页面模板目录可配置，测试用临时模板 |
| 日期、排除原因、价格、过敏说法在网页和 iMessage 各写一份 | 合并到 `src/out/labels.ts` 和 `dayName()` |
| 发布后确认时方案视图算两遍；地图代理为一张图拼整个看板 | 只算一次，按需取数据 |
| 发布时还没回复的人看到"这次去不了" | 他们照常看到收集中的页面，之后补答按变更处理 |
| 看板页脚在待核实、等司机时仍然提示 approve | 按情况提示：先打电话，或者正在等谁答复 |
| "a egg allergy" | 按元音用 a / an |
| 404 的链接一直轮询 | 404 之后停止 |

另外：
- 去掉了只在本文件里用的导出；
- 删掉了用不上的 `travel_times` 表和 `MAPS_BROWSER_KEY`；
- 管线拆成收消息（`pipeline.ts`）和发消息（`outbox.ts`）；
- 出站动作改成纯数据（去掉 `onSent` 回调），所以能存进 `scheduled` 表晚点发。
