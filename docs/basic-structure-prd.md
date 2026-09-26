# AI Event Planner — Basic Structure PRD

版本：v0.1 · 日期：2026-09-25 · 状态：可用于任务拆分的开发基线，尚非用户确认的最终规格。

配套文档：[3 位 Developer 详细分工](./three-developer-work-breakdown.md)。两份文档使用同一套 Feature ID；本文定义产品行为，配套文档定义唯一 Owner 与交付责任。冲突时产品行为以本文为准，契约变更须同步两份文档。

## 1. 产品目标与来源

产品是面向多人线下活动的 AI coordination agent：组织者描述意图，参与者通过一个链接回答问题，系统将时间、地点、餐饮、预算、偏好与接送约束转化为可执行方案；组织者审核授权后，系统发送个性化邮件及日历邀请。

本 PRD 基于所引用对话中组织者与参与者的完整产品描述，以及对话中提出的审核、报告、接送与约束求解流程。竞品描述不作为实现依据。以下关于人数上限、验证流程、版本机制、接口及技术拆分的内容是为减少实现冲突而制定的 **MVP 默认决策**，不是用户已经明确指定的事实。

核心价值：减少组织者逐人收集、人工整理和反复协调的工作；成功标准不是生成一篇流畅的行程，而是每个被安排参加的人都有符合其已确认约束的安排。

### 1.1 用户与需求

| 用户 | 任务 | 成功结果 |
|---|---|---|
| Planner | 描述活动、明确优先级、分享链接、审核方案、授权发送 | 不用处理巨大表格，也能理解方案、冲突和必要确认项 |
| Attendee | 提交个人约束、修改回答、查看自己的安排 | 不注册、不付费；预算、过敏、出行等信息真正影响安排 |
| Driver | 以参与者身份提供车辆与接送意愿 | 明确去程/返程、乘客、集合点、时间与允许绕路范围 |

Driver 是 Attendee 的属性，不是第三套账号或独立产品端。Planner 若参加活动，必须另建自己的参与者记录，不能隐式算进人数或车辆容量。

### 1.2 不可破坏的产品原则

1. 无需安装 App、注册账号或设置密码；邮件验证是活动级身份验证，不建立通用用户账号。
2. 收集、推荐、求解均不能发送最终安排；只有明确的 Planner 授权或取消确认可触发相关通知。
3. LLM 负责澄清、结构化提取与解释；确定性校验与求解负责时间、预算、容量等规则。LLM 无权直接写授权状态或调用发送服务。
4. 硬约束不能因排序更好而被偷偷放宽。无解、未知和未验证必须明确呈现。
5. 每份方案绑定输入快照与版本；已发送内容可追溯，修改不会悄悄覆盖历史。
6. 参与者默认只看自己的信息和公开活动内容；不公开全体邮箱、地址、饮食或预算明细。

## 2. MVP 范围与默认决策

### 2.1 本期范围

- 响应式 Web，两种界面：Planner 工作台、Attendee 对话与个人行程页。
- 单城市、单日、2–50 名已提交参与者；最多一个餐饮环节与一个可选活动环节；支持开始/结束与往返接送。
- 单一活动时区与币种；时间内部存储 UTC，显示采用活动时区并提示参与者本地时区差异；金额使用最小货币单位整数。
- 组织者自然语言输入、动态澄清、结构化摘要确认、可分享的收集链接。
- 参与者逐步对话、选择控件、草稿续填、姓名邮箱验证、摘要确认、修改与退出。
- 时间、饮食/过敏、预算、活动偏好、无障碍、出发位置、车辆座位与接送约束联合处理。
- 地点候选搜索、路线时间估计、来源与待核实项；支持组织者补充候选地点和核实证据。
- 输出一份主方案及最多两份可行备选；没有备选时说明原因，不为凑数虚构方案。
- 审核、约束修改、重算、明确授权、个性化邮件、日历邀请/下载、个人行程页。
- 授权后变更必须重新收集或重算、重新授权；支持整场取消与失败发送重试。

### 2.2 必须统一的边界决策

| 问题 | MVP 决策 | 原因/影响 |
|---|---|---|
| “所有人提交”如何判断？ | MVP 使用开放分享链接，不具备准确受邀名单。展示 expectedCount 与已验证提交数，但仅 Planner 手动关闭收集才触发求解 | 达到预计人数不代表特定成员已齐；避免错误自动定案 |
| 截止时间到达怎么办？ | 停止新建/编辑提交，显示“待组织者关闭”；不自行授权或发送 | Planner 可延长截止时间或关闭现有集合 |
| 未回复、未验证如何处理？ | 不进入求解；关闭前展示数量与缺失说明 | 不把未知信息当成默认同意 |
| 无账号如何管理活动？ | 创建后临时会话；发布收集链接前验证 Planner 邮箱；后续通过限时 magic link 恢复 | 公开分享链接不具备管理权限 |
| 同一人重复提交？ | 每活动内规范化邮箱唯一；已有邮箱必须验证后恢复原记录 | 不因邮箱存在向匿名请求泄露个人状态 |
| 日历“自动写入”如何实现？ | MVP 发带个人 ICS 的日历邀请并提供 Add to Calendar/下载；是否自动入历由客户端设置决定 | 不承诺无权限直接写日历；直接读写 Calendar 的 OAuth 集成延期 |
| 过敏和场地可用性？ | 搜索信息只能作候选依据。涉及过敏、容量、营业、无障碍的关键未知项阻止授权，需 Planner 记录人工核实 | 不把 AI 文案当作商家确认或安全保证 |
| 活动费用？ | 参与者免费；MVP 不提供收费结算；Planner 收费模式未定，本期不做付费墙 | 与原描述一致，不扩展商业系统 |
| 出行模式？ | 已确认私家车拼车或自行到达；不调用网约车、不售票 | 车辆、绕路、去返程必须可实际满足 |
| 数据语言与区域？ | 首发 UI 使用英文，允许中英文输入；一个试点城市、单币种 | 这是建议默认值，具体城市、币种与界面语言可在实现前配置替换 |

### 2.3 Out of scope

原生 App、用户社交关系、长期个人画像、多组织账号、协同管理员、公开活动广场、多人聊天、投票竞赛、自动拉取通讯录、自动邮件催填、SMS/微信发送、多日旅行、跨城市联程、实时车辆追踪、动态交通调度、自动订餐订位或购票、支付/AA 收款、供应商交易、Calendar OAuth 直接写入/读取忙闲、无限人数、保证全局最优或保证所有人都能参加。

人工核实候选场地是 MVP 的真实步骤；系统报告不得称为“已预订”。用户手工转发收集链接，不在本期做系统批量邀请邮件。

## 3. 端到端核心流程

### 3.1 Planner

1. 输入活动想法，系统建立 DRAFT 与临时管理会话。
2. Agent 一次询问一个有决策价值的问题：日期范围、持续时长、城市、预算硬上限或偏好、活动组合、必须到场人员规则、交通与公平性等。
3. 展示结构化摘要与“将向参与者收集的信息”；所有重要推断可修改，模糊内容不自动确认。
4. 验证组织者邮箱，确认摘要并发布链接，进入 COLLECTING。
5. 分享链接；工作台查看 verified/submitted/draft 数量及匿名化缺失项。组织者不能代替参与者同意更高预算或删除其过敏约束。
6. 截止或人数足够时，Planner 查看关闭收集提示并确认；系统冻结输入快照、异步求解。
7. 查看报告：能参加/不能参加的人、理由、时间地点、费用上限、活动、往返接送、待核实事项、方案来源与版本。
8. 修改组织者约束或补充核实证据后重算；必要时重新开放收集，让参与者修改自己的约束。
9. 选择一个当前版本的可行方案；预览通知人数、未安排人员、个人邮件示例，明确点击 Authorize Plan。
10. 查看投递进度；失败可重试。后续变更生成新版本并重新授权，或明确取消。

### 3.2 Attendee

1. 公开链接仅显示活动标题、组织者显示名、候选日期、时区、截止时间和收集用途；不显示人员名单。
2. 简短说明将收集哪些敏感信息及用途；可用公共集合点代替家庭住址。
3. 对话收集可用时段、预算、饮食与过敏、活动偏好、无障碍、交通等；已有明确回答不重复询问。
4. 条件追问：有车才问可带乘客数、去返程意愿和绕路；需要接送才问集合点、返程地点及时间。模糊“周六六点以后”须绑定具体日期与时区确认。
5. 最后提交姓名、邮箱，确认结构化摘要、用途同意和同车信息共享范围；验证邮箱后提交才生效。
6. 页面显示“已提交，等待计划确认”，可通过私有恢复链接修改自己的数据，不需重填全部内容。
7. 授权后收到个人邮件、日历附件与个人行程链接；被排除者收到“本次未安排参加”的说明，不收到参加邀请。
8. 修改、退出或撤销共享许可后，现有计划显示需要重新确认；系统不替组织者直接发新安排。

### 3.3 失败与恢复路径

| 场景 | 必须行为 |
|---|---|
| LLM 不可用或提取不合法 | 保留草稿，切换同字段的简洁输入控件；禁止生成已确认但实际未校验的值 |
| 地图或地点提供方失败 | 展示服务失败/缓存时间；关键路线缺失为 UNKNOWN，方案不可授权；允许补充可追溯人工估计后重算 |
| 没有可行方案 | 显示冲突涉及的约束与可尝试修改项；保留输入；不静默删除人员或放宽过敏/预算 |
| 邮件失败 | 单收件人级别状态与重试；其他成功发送不回滚；“服务商已接收”不显示成“已读” |
| 授权与参与者修改同时发生 | 服务端锁定并检查 inputVersion；旧版本返回冲突，不能继续排队发送 |
| 授权后有人变更 | 记录变更并标记当前已发布计划需更新；旧快照保留，新增方案不能自动替代 |
| 未验证或链接失效 | 提供重新发送验证邮件/恢复入口；禁止通过知道邮箱直接取得旧答案 |

## 4. 功能清单与行为边界

所有下列 F01–F48 均为 MVP 必须交付项；优先级 P0 表示发布阻断，P1 表示可在后半程实现但正式 MVP 发布前仍需完成。分工文档逐项给出 Owner、依赖与验收交付。

| ID | 功能 | 基础行为与验收边界 | 优先级 |
|---|---|---|---|
| F01 | 创建活动 | 自然语言输入、建立草稿与临时会话，不重复创建 | P0 |
| F02 | Planner 对话 UI | 展示追问、重试、结构化控件与保留输入 | P0 |
| F03 | 意图解析与澄清 | 输出 schema 合法的字段建议与下一问；不直接覆盖已确认硬约束 | P0 |
| F04 | 摘要确认 | 展示全部生效设置、缺失项、硬软约束，确认后才能发布 | P0 |
| F05 | Planner 验证恢复 | 邮箱验证、magic link、会话到期与登出，无密码账号 | P0 |
| F06 | 发布与分享 | 创建/轮换公开收集链接、截止时间、复制链接 | P0 |
| F07 | 收集工作台 | 已验证提交数、草稿数、预计人数、缺失和截止状态 | P0 |
| F08 | 关闭/重新开放 | 关闭冻结快照并排队；重新开放使未授权方案失效 | P0 |
| F09 | Attendee 入口 | 安全的公开活动摘要、用途提示与同意入口 | P0 |
| F10 | Attendee 对话 UI | 单问题、条件控件、草稿续填、断线恢复 | P0 |
| F11 | 回答结构化 | 条件追问、冲突澄清、置信度与来源，不重复询问已知信息 | P0 |
| F12 | 可用时间 | 多个具体时间窗口、最晚返程、时区/DST 歧义确认 | P0 |
| F13 | 预算 | 每人硬上限与软偏好、币种、估价范围；拒绝负数 | P0 |
| F14 | 饮食与无障碍 | 过敏、饮食、无障碍分别记录，unknown 与 none 区分 | P0 |
| F15 | 车辆与接送 | 去返程、座位、绕路上限、集合点、同车共享同意 | P0 |
| F16 | 活动偏好 | 排序偏好与不可接受活动分开，支持不参加可选环节 | P0 |
| F17 | 提交与去重 | 姓名邮箱、摘要确认、验证后提交，活动内邮箱唯一 | P0 |
| F18 | 修改/退出 | 私有链接恢复；只改本人；保留其他字段；版本递增 | P0 |
| F19 | 地点与餐厅候选 | 检索、去重、来源时间、营业/容量/饮食事实与未知状态 | P0 |
| F20 | 地理编码与路线 | 候选集合点、道路时长矩阵、缓存与数据有效期 | P0 |
| F21 | 时间选择 | 满足被选参与者的可用时段与必要转场，列出排除原因 | P0 |
| F22 | 饮食/场地校验 | 硬约束匹配，关键未知项阻断；人工核实有记录 | P0 |
| F23 | 行程与预算求解 | 至多两环节及可选退出，各参与者费用上界不超硬预算 | P0 |
| F24 | 拼车求解 | 去返程分别安排、无超员、无重叠司机、按顺序计算接送 | P0 |
| F25 | 统一求解与冲突 | 确定性校验、主/备选、不可行报告、超时状态与分数说明 | P0 |
| F26 | Report UI | 人数、行程、费用、个人与车组安排、未满足项及证据 | P0 |
| F27 | 修订/重算 | 对话生成变更建议，组织者确认后形成新输入与新方案 | P0 |
| F28 | 版本与快照 | 输入、候选、方案、授权、发布一一可追溯；旧方案不可授权 | P0 |
| F29 | 授权 | 服务端检查权限、版本、可行性、核实项，幂等写授权与 outbox | P0 |
| F30 | 个性化邮件 | 参与者/司机/未安排者分别生成，模板与隐私最小化 | P0 |
| F31 | 发送与重试 | 按收件人记录、去重、退信、有限重试与失败提醒 | P0 |
| F32 | 日历产物 | 个人 ICS、时区、稳定 UID、更新序号与取消语义 | P0 |
| F33 | 个人最终行程页 | 当前授权版本、个人费用、集合点、去返程、变更提示 | P0 |
| F34 | 发布后变更 | 标记待更新、重算并重新授权，展示变更差异 | P0 |
| F35 | 整场取消 | 明确确认，取消状态、通知与日历取消，不再发未发送旧安排 | P0 |
| F36 | 权限与隐私 | 角色/事件/参与者范围校验、token 生命周期、字段投影 | P0 |
| F37 | 异步任务 | outbox、幂等、租约、超时、失败恢复、旧任务隔离 | P0 |
| F38 | 监控与审计 | 状态变更和发送审计、脱敏日志、任务告警 | P0 |
| F39 | 防滥用与成本 | 限流、活动人数/对话配额、模型成本上限 | P0 |
| F40 | 删除与保留 | 到期清理、本人数据删除请求、Planner 删除整场活动 | P1 |
| F41 | 移动与可访问性 | 小屏、键盘、焦点、屏幕阅读提示、错误定位 | P1 |
| F42 | 降级与恢复 | LLM 控件降级、提供方不可用、失败重试、一致的错误页 | P0 |
| F43 | 自动化验收 | 契约、求解不变量、权限、并发与端到端测试 | P0 |
| F44 | 部署与运维 | 环境隔离、迁移、备份恢复、回滚、密钥管理 | P0 |
| F45 | 共享契约 | schema、OpenAPI、错误码、fixture、生成客户端 | P0 |
| F46 | 产品指标 | 漏斗、完成率、求解耗时、授权率、发送成功率 | P1 |
| F47 | 候选人工核实 | Planner 增补候选/核实记录 UI；结构校验后重算 | P0 |
| F48 | 交付与测试数据 | 本地种子数据、mock 外部服务、演示脚本、操作说明 | P1 |

## 5. 约束与求解规则

### 5.1 统一约束表示

`Constraint = {id, subjectType, subjectId, key, value, strength: HARD|SOFT, source: PLANNER|ATTENDEE|PROVIDER, sourceRef, confirmedAt, status: CONFIRMED|UNKNOWN}`。

LLM 提取的未确认值是 Proposal，不是生效 Constraint；先经用户确认再提升。数据缺失不得解释为“没有限制”。参加者不愿提供必要位置时可选择自行到达；不接受出行假设则该人不能被安排到拼车中。

硬约束包括：明确不可用的时间、最晚返程、个人预算上限、过敏、必须的饮食/无障碍、不可接受活动、司机意愿、车辆乘客容量、最大绕路以及位置共享许可。软约束包括：活动喜好、较低花费、少绕路、较公平的出行负担。

Planner 可修改其自身规则，不能覆盖参与者的硬约束。参与者本人变更硬约束须再次摘要确认与保存版本。MVP 不支持 Planner 通过“忽略警告”授权违反硬约束的方案。

### 5.2 可行性优先、再排序

1. 先过滤违反任何被选参与者硬约束的方案；必须到场参与者如无可行安排，则整个方案不可行。
2. 对未标记必须到场的人，允许在确实无法同时安排时排除，但逐人说明原因，并在授权页要求组织者确认排除名单；不得为了降低总费用减少可参加人数。
3. 按字典序排序：最大参加人数 → 最小最大个人绕路分钟数 → 最小总行车分钟数 → 最小总费用上界 → 最大活动偏好得分。Planner 可在创建时调整后三项顺序，不能调换硬约束优先级。
4. 同输入快照、相同 provider snapshot、相同 solverVersion 和 seed，输出排序必须一致；ID 作最终平局规则。
5. MVP 可以使用有限候选枚举与启发式搜索；报告标注“本次搜索中的推荐方案”，不宣称全局最优。

### 5.3 交通、费用与证据细则

- `passengerSeats` 不含司机；去程/返程容量和时间分别检查。司机也算活动参与者与就餐人数。
- 每名需要接送的人在每段必需行程恰好分配一次；起点→接人→地点→活动→返程按时间顺序计算，不用直线距离代替道路时间。
- 返程最晚到达约束包含送回集合点的时间；司机只愿去程时不得隐式分配返程。
- 若某人跳过可选活动，必须同时存在可行的提前返程或已确认的自行离开方式。
- 默认安排 10 分钟到达缓冲；该值可配置且写入方案快照。人工路线估计必须包含来源、时间与保守时长，不得把缺失路线记为零。
- 每人费用上界 = 该人参加的餐饮、活动、税费/小费估计及已确认交通分摊上界之和。未知必需费用阻止授权；未明确分摊燃油时必须追问，不擅自假定免费。
- 金额估计包含上下界、币种、来源时间；以保守上界对比个人硬预算。报告说明这是估计，不是已支付价格。
- 餐厅能否处理某种过敏、指定时段容量等，使用 `SUPPORTED / UNSUPPORTED / UNKNOWN` 与 evidence；Planner 可记录联系场地后的确认时间、来源与说明，但不得直接修改求解结果的“通过”位。
- 地点/费用/路线证据默认有效 24 小时；人工营业和容量确认绑定具体活动日期与时段。授权前过期关键证据触发重新核实与重算。
- 报告完整度与可信度分开：`FEASIBLE`、`INFEASIBLE`、`NEEDS_VERIFICATION` 是不同结果，不用流畅解释掩盖未知。

## 6. 页面与功能模块

| 页面/模块 | 输入 | 输出 | 边界 |
|---|---|---|---|
| `/` 创建 | 活动描述 | DRAFT、临时会话 | 不展示管理 token |
| `/planner/events/:id` | 管理会话、工作台 DTO | 对话、摘要、收集、报告、授权视图 | 只调用应用 API，不调用模型/地图/邮件 |
| `/e/:publicCode` | 公开 code | 安全活动摘要、个人对话入口 | 无名单、无个人答案 |
| `/attendee/events/:id` | 个人会话 | 本人回答、提交、修改与行程 | 身份从会话推导，不能传任意 personId 越权 |
| 身份与活动服务 | 请求、身份、版本 | 持久化记录、状态与任务 | 所有数据库写入的唯一入口 |
| 对话/求解引擎 | 明确 schema 的上下文和快照 | 字段建议、问题、PlanResult | 无业务数据库写权限，无发送能力 |
| Provider 适配器 | 地点/路线查询 | 标准候选与证据 | 仅服务端，返回可追溯数据 |
| 通知模块 | 已授权/取消的不可变快照 | 个人邮件、ICS、投递记录 | 不从实时可变答案拼邮件 |

## 7. 数据模型与约束

不建立全局 User 表。标识符使用不透明 ID；下表为逻辑模型，迁移实现由 Developer B 统一管理。

| 实体 | 主要字段 | 约束/关系 |
|---|---|---|
| Event | id, title, lifecycle, timezone, currency, city, expectedCount, deadlineAt, inputVersion, lockVersion, currentPublishedPlanId, needsUpdate, createdAt | lifecycle 见状态机；currentPublishedPlanId 仅指已授权不可变方案 |
| PlannerIdentity | id, eventId, displayName, emailEncrypted, verifiedAt | 单活动一个 Planner；不跨活动关联用户 |
| AccessGrant | id, eventId, attendeeId?, role, tokenHash, expiresAt, revokedAt, usedAt | PUBLIC code 不等于管理权限；token 不存明文 |
| RequirementsRevision | id, eventId, revision, durationMinutes, candidateWindows, constraints, optimizationOrder, requiredAttendeeIds | 确认后不可变；修改创建新 revision |
| Conversation | id, eventId, actorScope, actorId, status, lastMessageSequence | 每消息 sequence 唯一，隔离 Planner 与 Attendee |
| Message | id, conversationId, clientMessageId, sequence, role, text, extractionProposal | clientMessageId 幂等；原文按保留策略清理 |
| Attendee | id, eventId, name, normalizedEmailHash, emailEncrypted, verifiedAt, status, responseRevision | (eventId, normalizedEmailHash) 对已绑定记录唯一；邮箱修改需重新验证 |
| ResponseRevision | id, attendeeId, revision, availability[], budget, dietary[], accessibility[], transport, activityPreferences, consents, confirmedAt | 不可变；只有已确认且已验证提交进入求解 |
| Transport | mode, pickupPoint, returnPoint, outwardWindow, returnBy, driveOutbound, driveReturn, passengerSeatsOutbound, passengerSeatsReturn, maxDetourMinutes, shareConsent | 位置加密；mode=SELF 或 CARPOOL；字段按角色验证 |
| Consent | purposeVersion, collectionAcceptedAt, rideSharingAcceptedAt?, withdrawnAt? | 接送共享许可独立，撤回会导致相关方案失效 |
| CandidateSnapshot | id, eventId, provider, providerPlaceId?, facts, prices, evidence[], fetchedAt, expiresAt | facts 含三态验证；人工候选标记 manual 来源 |
| VerificationRecord | id, candidateId, factKey, value, sourceDescription, verifiedBy, verifiedAt, applicableWindow | 只记录证据，生效要形成新快照和重算 |
| PlanningInput | id, eventId, inputVersion, requirementsRevisionId, responseRevisionIds[], candidateSnapshotIds[], contentHash, schemaVersion | 冻结、不可变；求解与重放的唯一输入 |
| SolveJob | id, eventId, inputId, status, attempt, leaseUntil, resultId?, errorCode | 同 inputId+solverVersion 幂等；旧结果不可变成当前结果 |
| ConversationJob | id, eventId, conversationId, actorScope, actorId, status, attempt, resultRef?, errorCode | 仅所属会话主体可查询；与 SolveJob 分类型存储，不暴露求解快照 |
| PlanVersion | id, eventId, inputId, solverVersion, status, options[], selectedOptionId?, constraintsCheck, exclusions[], warnings[], createdAt | 生成后内容不可变；选中 option 在授权记录里固化 |
| PlanOption | id, attendanceIds[], itinerary[], personCosts[], rideGroups[], explanationFacts, score | 不含未确认虚构事实；输出必须经独立不变量校验 |
| Authorization | id, eventId, planId, optionId, inputVersion, authorizedBy, authorizedAt, acknowledgedExclusions[], idempotencyKey | 一个具体 option 的授权；不可被后续文本变更复用 |
| OutboxEvent | id, type, aggregateId, payloadRef, createdAt, processedAt | 与授权/取消业务写入同事务 |
| Delivery | id, eventId, publicationId, attendeeId, type, status, providerMessageId, attempt, lastError | (publicationId, attendeeId, type) 唯一；邮件包括对应日历附件 |
| CalendarArtifact | id, eventId, attendeeId, uid, sequence, publicationId, method, contentHash | 每活动每人一个稳定 UID；每次授权/取消递增 sequence |
| AuditEvent | id, eventId, actorScope, action, targetId, beforeVersion, afterVersion, timestamp, requestId | 不记录完整敏感回答或 token |

### 7.1 必须共享的值类型

- `TimeWindow = {startAt, endAt, timezone}`，startAt/endAt 使用带偏移 ISO 8601；endAt > startAt。模糊日期不进入此类型。
- `MoneyRange = {currency, minMinor, maxMinor, includes[], sourceRef}`；min ≤ max，负数非法。
- `Location = {id, label, lat, lng, precision: AREA|MEETING_POINT|EXACT, encryptedAddressRef?}`；对外 DTO 按权限裁剪。
- `ConstraintCheck = {constraintId, subjectId, outcome: PASS|FAIL|UNKNOWN, reasonCode, evidenceRefs[]}`。
- `RideGroup = {leg, driverId, passengerIds[], stops[{personId?,locationId,arrivalAt,departureAt}], seatsUsed, detourMinutes}`。
- 所有 schema 含 `schemaVersion`，共享枚举禁止各端复制改名。

## 8. 状态机与并发语义

### 8.1 Event 生命周期

`DRAFT → COLLECTING → PLANNING → REVIEW → PUBLISHED → COMPLETED`，任一未结束状态可由 Planner 明确取消进入 `CANCELLED`。

| 当前状态 | 动作 | 下一状态 | 条件/副作用 |
|---|---|---|---|
| DRAFT | publishCollection | COLLECTING | Planner 已验证、requirements 完整；产生公开 code |
| COLLECTING | closeCollection | PLANNING | 至少 2 个有效提交、确认当前人数；原子冻结输入并 enqueue |
| PLANNING | solveSucceeded | REVIEW | 结果与当前 inputVersion 相同；不可行结果也进 REVIEW 供解释 |
| PLANNING | solveFailed | REVIEW | job=FAILED，保留错误，允许重试，不能授权 |
| REVIEW | revise/recompute | PLANNING | 确认的新输入快照；旧结果标记 stale |
| REVIEW/PLANNING | reopenCollection | COLLECTING | 使未授权方案失效；运行中的旧 job 可结束但不能生效 |
| REVIEW | authorize | PUBLISHED | FEASIBLE、无关键 UNKNOWN、版本/证据新鲜、明确确认排除名单 |
| PUBLISHED | attendeeChange / plannerRevision | PUBLISHED | needsUpdate=true；currentPublishedPlanId 保留，待更新求解独立运行 |
| PUBLISHED | authorizeReplacement | PUBLISHED | 同样检查新快照；替换 currentPublishedPlanId；needsUpdate=false |
| PUBLISHED | complete | COMPLETED | 服务端在最终行程结束 24 小时后自动结束；不可再安排更新 |
| 任一非终态 | cancel | CANCELLED | 明确取消确认；撤销未发送旧通知并排入取消任务 |

发布后的修订通过独立 `revisionState = NONE|COLLECTING|PLANNING|REVIEW` 表达，不把 Event 回退成未发布状态；当前已授权安排始终可查。needsUpdate=true 时个人页显示“有信息变更，等待组织者确认”，不把新提案当最终方案。

修改窗口统一规则：首次收集截止后及 PLANNING/REVIEW 期间，不接受普通回答修改或新成员提交，需 Planner 重新开放；退出、撤销同意和删除始终允许，并使相关快照失效。PUBLISHED 期间，已有成员可主动更新本人约束，不受首次收集截止时间限制，保存后标记 needsUpdate；新增成员仍需 Planner 开启修订收集。修订收集关闭后才能对该批输入求解。若未开启修订收集，Planner 可直接对当前已提交更新启动重算。COMPLETED/CANCELLED 仅允许查看尚在保留期内的历史及删除，不再接受用于规划的修改。

### 8.2 其他状态

- Attendee：`DRAFT → PENDING_VERIFICATION → SUBMITTED → WITHDRAWN`；SUBMITTED 修改产生新 ResponseRevision，身份验证有效且摘要确认后仍为 SUBMITTED。WITHDRAWN 恢复须在开放收集期间明确重新提交。
- SolveJob：`QUEUED → RUNNING → SUCCEEDED | FAILED | SUPERSEDED`；超时释放租约后有限重试，不无限等待。
- Plan 结果：`FEASIBLE | INFEASIBLE | NEEDS_VERIFICATION`；新输入产生后派生 `isStale=true`，不覆盖历史内容。
- Delivery：`QUEUED → SENDING → ACCEPTED → DELIVERED`，或 `FAILED_RETRYABLE | FAILED_FINAL | BOUNCED | SUPPRESSED`。无送达回执时停在 ACCEPTED。

### 8.3 授权事务与发送

授权请求携带 planId、optionId、expectedInputVersion、expectedLockVersion 和 Idempotency-Key。服务端在一个事务中锁 Event，验证权限、当前版本、硬约束校验、核实有效期与排除确认，再写 Authorization、currentPublishedPlanId 与 outbox。重复请求返回原结果；版本变化返回 409。

只有 outbox dispatcher 可创建 Delivery。发送任务引用不可变授权快照，不读实时回答。发送前检查取消、撤销收件许可、更新版本是否已取代本次待发送安排；失效任务变 SUPPRESSED。已被服务商接受的旧邮件无法撤回，后续授权/取消通过新通知与日历序号纠正。不能声称分布式邮件绝对 exactly-once：内部幂等、提供方幂等键与超时对账共同降低重复风险，无法确认时先对账再重发。

## 9. API 与内部接口契约

### 9.1 通用规则

- 外部 API 前缀 `/api/v1`，JSON；Web 与 worker 不能绕过服务层修改业务表。
- 会话使用 HttpOnly/Secure/SameSite Cookie；写请求校验来源与 CSRF。公开 code 只作活动查找。
- 会修改状态的 POST 支持 `Idempotency-Key`；PATCH 与授权同时携带 expectedLockVersion。重复 key+相同 payload 返回原结果，key 相同 payload 不同返回 409。
- 成功返回 `{data, meta:{requestId, schemaVersion, lockVersion?}}`；错误返回 `{error:{code,message,fieldErrors?,retryable},meta:{requestId}}`。客户端按 code 分支，不解析文案。
- 主要错误：`VALIDATION_ERROR(422)`、`UNAUTHENTICATED(401)`、`FORBIDDEN(403)`、`NOT_FOUND(404)`、`VERSION_CONFLICT(409)`、`INVALID_STATE(409)`、`PLAN_STALE(409)`、`HARD_CONSTRAINT_VIOLATION(422)`、`VERIFICATION_REQUIRED(422)`、`RATE_LIMITED(429)`、`PROVIDER_UNAVAILABLE(503)`。
- 涉及不存在或无权访问的敏感对象统一 404；验证邮件接口统一 202，避免邮箱枚举。
- 列表 cursor 分页；客户端轮询 job，不在 MVP 强制 WebSocket。POST 异步操作返回 202 与 jobId。

### 9.2 外部 API 清单

Developer B 是所有外部路由、身份、事务与持久化 Owner；A 定义视图需求并消费 API，C 实现内部引擎与 provider 适配器。

| 方法与路径 | 授权 | 输入/输出要点 |
|---|---|---|
| POST `/events` | 匿名限流 | initialText → eventId、临时会话；DRAFT |
| POST `/auth/challenges` | 匿名/临时会话 | purpose、eventId、email → 通用 202；验证/恢复链接 |
| POST `/auth/exchange` | 一次性 token | token → event/attendee scoped cookie；token 消耗 |
| POST `/auth/logout` | 会话 | 撤销当前会话 |
| GET `/events/:eventId` | Planner | 工作台 DTO、版本、计数、状态，不返回 token |
| POST `/events/:eventId/messages` | Planner | text、clientMessageId → 提问与字段 Proposal |
| PATCH `/events/:eventId/requirements` | Planner | 已确认字段/constraint patch、版本 → 新 revision |
| POST `/events/:eventId/collection/publish` | 已验证 Planner | 摘要 revision → 公开链接 |
| PATCH `/events/:eventId/collection` | Planner | deadlineAt、expectedCount、版本 → 设置 |
| POST `/events/:eventId/collection/rotate-link` | Planner | 轮换 code；已验证个人会话保留 |
| POST `/events/:eventId/collection/close` | Planner | expectedInputVersion、人数确认 → jobId |
| POST `/events/:eventId/collection/reopen` | Planner | 新 deadlineAt → 开放收集/修订收集 |
| GET `/public/events/:code` | public | 仅公开摘要；不存在/撤销同样处理 |
| POST `/public/events/:code/sessions` | public 限流 | 用途同意 → 匿名 attendee 草稿会话 |
| GET `/events/:eventId/me` | Attendee | 本人草稿、摘要、验证/提交状态 |
| POST `/events/:eventId/me/messages` | Attendee | 消息 → 本人字段 Proposal 与下一问 |
| PATCH `/events/:eventId/me/response` | Attendee | 已确认字段、版本 → 草稿；已发布后的保存需明确提交 |
| POST `/events/:eventId/me/submit` | 已验证 Attendee | name、摘要 hash、consents、版本 → SUBMITTED 与新 inputVersion |
| POST `/events/:eventId/me/withdraw` | Attendee | 原因可选 → WITHDRAWN、新版本、needsUpdate |
| GET `/events/:eventId/candidates` | Planner | 候选、证据与缺失项 |
| POST `/events/:eventId/candidates` | Planner | 手工地点与证据 → 标准候选、新 inputVersion |
| POST `/events/:eventId/candidates/:id/verifications` | Planner | factKey、值、来源、时间 → 新证据、新 inputVersion |
| POST `/events/:eventId/solve` | Planner | 当前 inputVersion → jobId；关闭收集状态才可求解 |
| GET `/events/:eventId/jobs/:jobId` | Planner | 状态、错误、planId |
| GET `/events/:eventId/conversation-jobs/:jobId` | 所属会话的 Planner/Attendee | 仅该主体对话任务的状态、结果与错误 |
| GET `/events/:eventId/plans/:planId` | Planner | 完整安全报告 DTO、isStale |
| POST `/events/:eventId/plans/:planId/authorize` | Planner | optionId、版本、acknowledgedExclusions → publicationId |
| GET `/events/:eventId/deliveries` | Planner | 个人投递状态，不含邮件 token |
| POST `/events/:eventId/deliveries/:id/retry` | Planner | 仅可重试状态，重用业务幂等标识 |
| GET `/events/:eventId/me/itinerary` | Attendee | 个人授权方案投影、needsUpdate |
| GET `/events/:eventId/me/calendar.ics` | Attendee | 个人 ICS，禁止共享缓存 |
| POST `/events/:eventId/cancel` | Planner | 明确确认、版本、reason → 取消 publication |
| DELETE `/events/:eventId/me/data` | Attendee | 删除本人数据；影响当前计划则标记需更新 |
| DELETE `/events/:eventId` | Planner | 整场删除；已发布未来活动先明确执行取消 |
| POST `/webhooks/email` | 服务商签名 | 去重投递回执，不能修改授权或方案 |

消息接口允许 202 conversationJobId，随后使用 conversation-jobs 接口按会话主体查询；参与者不能查询 Planner 的求解 job。C 无法及时响应时 B 持久化草稿并给 A 降级字段。具体 OpenAPI 是 G0 的实际工程交付，不要求前端从本文手写所有类型。

### 9.3 B ↔ C 内部边界

| 接口 | B 提供 | C 返回 | 禁止事项 |
|---|---|---|---|
| `clarify(ConversationContext)` | 角色、已确认字段、最少必要历史、allowedFields、locale | message、fieldProposals、missingFields、nextQuestion、confidence | 不修改 DB、不授权、不读取其他参与者原始会话 |
| `getCandidates(SearchInput)` | 区域、窗口、约束摘要、候选上限 | CandidateSnapshot[]、provider 状态 | 不伪造搜索结果，不把 UNKNOWN 变 SUPPORTED |
| `getRouteMatrix(RouteInput)` | 脱敏 location ID 与坐标、出发窗口 | travelMinutes、source、fetchedAt、expiresAt、missingPairs | 不回传第三方密钥，不以 0 代替失败 |
| `solve(PlanningInput)` | 冻结快照、schemaVersion、seed、timeoutBudget | PlanResult、solverVersion、inputHash、constraintChecks、diagnostics | 不发邮件、不写活动状态、不自行读实时答案 |
| `validatePlan(PlanningInput, PlanOption)` | 相同快照与待授权结果 | 校验项与可授权布尔值 | 独立校验器必须重算关键不变量，不只相信 solver 的声明 |

C 提供可导入的模块/worker runner；B 管理队列、持久化、任务状态与部署。开始可同仓同部署，不强制微服务。C 的 provider 网络请求有独立超时与取消信号。

## 10. 权限、隐私与数据生命周期

| 身份 | 可读 | 可写/操作 | 不可访问 |
|---|---|---|---|
| Public | 活动公开摘要 | 建立个人草稿 | 人员名单、答案、报告、管理 API |
| Planner 临时 | 自己 DRAFT | 编辑意图、请求邮箱验证 | 发布、授权、他人数据 |
| Planner 已验证 | 本活动报告、提交状态、必要约束明细 | 配置、关闭、修订、核实、授权、取消 | 代替参与者确认个人硬约束、其他活动 |
| Attendee | 自己回答、公开行程、本人行程、获同意的同车信息 | 本人回答、退出、删除、同意设置 | 他人邮箱/饮食/预算/精确地址、完整报告 |
| Driver | 本人行程与获许可的本车组姓名/集合点 | 本人车辆信息 | 非本车组地址及任何乘客饮食/预算 |
| Worker | 指定任务所需快照 | 经 B 服务层写 job/delivery 结果 | 自行创建授权或扩大任务范围 |

- 接送双方在收集时同意将名字及集合点分享给指定车组；邮件不附全车组联系方式、过敏明细或住宅地址，详细位置只在有权限的个人页面显示。
- Planner 查看必要敏感信息前，参与者在收集用途说明中应已知情；报告默认聚合，按需展开个人冲突。
- magic link 默认 15 分钟、一次性；兑换后清理 URL，Referrer-Policy 禁止泄露；管理和个人 session 默认 7 天并可撤销。公开 code 可轮换。所有有效期可配置但需共同测试。
- 邮件验证链接 GET 只展示确认页，POST 才兑换，避免邮件安全扫描误消耗 token。长期个人行程链接在会话失效后走邮箱恢复，不永久暴露敏感数据。
- TLS、敏感字段静态加密、密钥与日志隔离；发送给模型的内容最小化，不发送邮箱、明文 token、无关精确地址。
- 默认活动结束/取消 30 天清理原始会话与敏感个人内容；未完成草稿闲置 7 天删除；去标识审计与汇总指标保留 90 天。备份最长 30 天滚动淘汰，恢复时重放删除标记。
- 删除请求在 24 小时内完成主存储清理、撤销访问并停止未发送任务；不得承诺删除收件箱里已发出的邮件。需要最小发送去重/取消记录时保留不可还原标识到保留期结束。

## 11. 非功能需求与运营基线

以下为工程验收目标而非已达到的性能声明。

| 维度 | MVP 目标 | 测量方式 |
|---|---|---|
| 规模 | 单活动 50 人、50 个已验证提交；超限清楚拒绝 | 集成 fixture；并发第 50/51 人提交测试 |
| API 性能 | 排除外部提供方的普通 API p95 < 500ms | 100 并发请求、10 分钟受控负载 |
| 对话 | 正常外部服务下 p95 首次有效响应 < 8s；15s 降级/异步提示 | 固定对话集与超时模拟 |
| 求解 | 50 人、20 地点候选、3 日期窗口下 p95 < 60s；120s 硬超时 | 固定硬件配置记录在性能报告 |
| 通知 | 正常提供方下授权后 2 分钟内全部进入 ACCEPTED 或明确失败状态 | 队列/模拟提供方时序测试 |
| 可靠性 | 队列重启不丢授权任务；关键状态修改具事务与审计 | 故障注入与重放测试 |
| 可用性 | 试点月度服务可用性目标 99.5%，外部依赖失败独立统计 | 监控探针与事件日志 |
| 可访问性 | 核心流程键盘可完成；输入有 label、错误提示可读；360px 宽不横向溢出 | 自动扫描加人工走查 |
| 配额 | 每活动最多 50 人；每角色会话默认 40 轮；模型超预算切控件 | 限流/配额集成测试；不静默丢答案 |
| 恢复 | 备份恢复目标 RPO ≤24h、RTO ≤4h | staging 恢复演练与记录 |
| 可观察性 | requestId、eventId、inputVersion、jobId 贯通；不含敏感原文 | 日志抽样和敏感字段测试 |

配额、模型单活动成本上限、限流阈值均配置化；生产开启外部费用前由团队确定数值。成本达到阈值后已有用户仍能保存/查看数据，不把服务商账单风险转嫁成丢失提交。

指标事件：event_created、requirements_confirmed、collection_published、attendee_started、attendee_submitted、collection_closed、solve_completed、plan_authorized、delivery_accepted、delivery_failed、plan_revised。A 发交互事件，B 发唯一业务事实事件，C 发求解诊断；同一事件不重复计数。不把邮箱、地址或约束内容作为分析属性。

## 12. 验收标准与发布门槛

| AC | 场景 | 必须满足 | Feature |
|---|---|---|---|
| AC01 | 全流程 10 人活动 | 不注册，创建→分享→提交→报告→授权→邮件/ICS/个人页完成 | F01–F18, F25–F33 |
| AC02 | 过敏/预算硬约束 | 有适配候选则满足；无适配候选则不可行或明确排除，不输出伪通过 | F13–F14, F22–F25 |
| AC03 | 座位与返程 | 司机有 3 乘客座位只能带 3 人；去返程均覆盖，最晚返程生效 | F15, F20, F24 |
| AC04 | 未回复/未验证 | 不计入有效提交；expectedCount 达到不自动关闭；关闭前看见缺口 | F07–F08, F17 |
| AC05 | 人数排除 | 必须到场者不能被排除；其他被排除者有理由与授权确认 | F21, F25–F29 |
| AC06 | 核实与证据 | UNKNOWN 或过期关键证据不能授权；补充证据后必须重算 | F19, F22, F28–F29, F47 |
| AC07 | 修改竞态 | 提交修改与授权竞态时只允许合法串行结果；旧 inputVersion 授权返回 409 | F18, F28–F29 |
| AC08 | 幂等与任务重启 | 双击授权、重复 worker 不产生两条内部 delivery；不确定发送先对账 | F29–F31, F37 |
| AC09 | 个人隐私 | A 的个人 token 无法读取 B 数据；公开链接无法管理；司机只看自己车组 | F33, F36 |
| AC10 | 日历更新取消 | 同人稳定 UID、递增 sequence；更新/取消不创建不必要的第二活动 | F32, F34–F35 |
| AC11 | 无解与降级 | 无解提供冲突；LLM/地图失败不丢回答、不以假数据继续授权 | F25, F42 |
| AC12 | 局部发送失败 | 一人退信不重发全体；工作台可区分 ACCEPTED、DELIVERED、BOUNCED | F30–F31 |
| AC13 | 授权前不发送 | 除验证/恢复邮件外，未授权无最终安排邮件、ICS 投递；取消通知例外有明确确认 | F05, F17, F29–F32, F35 |
| AC14 | 发布后修订 | 旧已授权计划保留且显示待更新；新计划仅再次授权后发送 | F28, F34 |
| AC15 | 50 人负载 | 在第 11 节规模与性能条件下通过；第 51 人原子拒绝而不破坏数据 | F25, F39, F43 |
| AC16 | 删除与取消竞态 | 删除撤销访问，取消抑制未发送旧任务，已发消息有正确后续取消 | F35–F37, F40 |
| AC17 | 可用性与恢复 | 手机/键盘可完成；worker 重启恢复；备份可恢复且删除记录不复活 | F41, F44, F48 |
| AC18 | 金额/时间边界 | DST 重复/不存在时刻要确认；金额上界含必需费用；可选活动退出仍有返程 | F12–F13, F23–F24 |

发布门槛：所有 P0/P1 功能完成；上述验收通过；无越权、硬约束违规、未授权发送、数据丢失类阻断问题；邮件身份/回执配置与日历样例在实际目标客户端人工验证；备份恢复与回滚演练完成。测试通过只证明系统按已确认信息安排，不证明商家实际履约或过敏安全。

## 13. 分阶段交付与待选配置

1. **G0 契约基线**：确认 MVP 决策、字段、枚举、接口、Owner；交付 schema、OpenAPI、fixture 与错误码。
2. **G1 收集闭环**：真实数据库和身份；两端无 AI 也能通过控件完成收集；暂用固定方案 mock。
3. **G2 求解闭环**：真实候选、路线、硬约束、报告、重算与无解处理；不启用真实最终邮件发送。
4. **G3 授权执行**：授权事务、个人邮件、ICS、更新、取消、重试、权限与并发通过。
5. **G4 试点发布**：真实客户端验证、50 人负载、可访问性、删除、恢复与运营说明完成。

实现前由团队在 G0 固化：首发城市/币种/语言、模型/地图/邮件供应商、成本上限、部署区域与敏感数据存储方案。本文不指定第三方供应商的当前价格、能力或服务承诺；选型另行验证，不改变上述接口。没有产品负责人另行决策前，按本文 MVP 默认行为开发，不能由各开发者私自做不同假设。
