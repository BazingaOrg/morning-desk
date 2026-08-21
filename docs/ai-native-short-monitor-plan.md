# Morning Desk AI-native 空头监控方案

## 1. 方案目标

在保留现有港美股晨报的基础上，新增一套由项目自身定时运行的“美股空头预期差与交易触发监控”。系统覆盖四个独立方向：

1. SpaceX / SPCX
2. Sandisk / SNDK
3. Nasdaq-100 / QQQ / NDX
4. 黄金 / XAUUSD / GLD

系统不因为估值高、涨幅大、单条利空、战争、解禁、研究报告或某个单一技术指标直接给出做空结论。只有在“本质变量变化、预期差存在、价格确认、催化剂存在、风险收益比合格”同时成立时，才允许进入执行候选。

这是一套研究与监控系统，不是自动交易系统，也不构成投资建议。

## 2. 实现后具备的功能

### 2.1 每天自动生成空头监控报告

- 项目在阿里云容器内常驻运行自己的 Scheduler，不再依赖宿主机 crontab。
- 每个工作日北京时间 09:00 自动运行。
- 09:00 报告是基于最近完整美股收盘、隔夜公告与宏观变化生成的隔夜快照，不是盘中交易 desk。
- V1 不拉取或解释实时盘前波动，也不提供即时成交信号。
- 服务重启或短暂宕机后，能够识别当天漏跑并补跑一次。
- 页面仍保留手动运行入口，自动任务与手动任务不会重复执行。

### 2.2 自动判断交易日与报告模式

- 启动后先记录北京时间、美东时间和数据截止时间。
- 根据 NYSE / Nasdaq 官方日历判断正常交易、提前收市或全日休市。
- 正常交易日生成完整报告。
- 提前收市日降低成交量和流动性信号权重。
- 全日休市日只检查重大宏观、公司公告、产业变化、地缘风险和重要研究；没有变化时输出固定的休市结论。
- 每周附加报告按“本周第一个实际美股交易日”触发，不机械等同于星期一。

### 2.3 固定的第一屏决策卡

报告第一屏固定展示：

- Action：`WAIT / PREPARE / ENTER / HOLD / REDUCE / EXIT`
- 最优机会：`SPCX / SNDK / Nasdaq / Gold / None`
- 静态配置的候选执行工具
- 一句话核心原因
- 最近 Trigger
- Stop / Invalidation
- Exit 条件
- R/R
- 数据截止时间与数据完整度

没有成熟机会时明确输出：`WAIT，不提前猜顶。`

Action 必须结合持仓状态：

- `FLAT`：只允许 `WAIT / PREPARE / ENTER`。
- `OPEN`：只允许 `HOLD / REDUCE / EXIT`，无操作时可显示 `WAIT`。
- `UNKNOWN`：只允许 `WAIT / PREPARE`，并提示持仓状态未知。
- 09:00 的 `ENTER` 只表示“满足下一美股常规交易时段的条件候选”，不表示立即成交。
- V1 的持仓状态由用户手动配置，不接入券商账户。

### 2.4 四方向状态与 Trigger Score

每个方向都有独立的：

- 状态：`WATCH / ARMED / CONFIRMING / TRIGGERED`
- Trigger Score 及分项分数
- Consensus
- Embedded Expectations
- Variant Perception
- Falsification
- Inflection
- Price Confirmation
- Veto
- 值搏率
- 今日变化

DeepSeek 只输出固定枚举档位、证据引用与分析叙事。所有数值分数、权重、封顶、Factor Cluster 去重、Veto、R/R、状态和 Action 均由确定性代码计算，模型不能直接输出或修改最终分数。

### 2.5 证据可追溯

- 每一条改变 Thesis 的判断必须引用一个或多个证据 ID。
- 页面可以展开证据来源、发布时间、抓取时间、数据口径和原始链接。
- 明确区分官方事实、产业数据、媒体报道、研究观点、预测市场和社交媒体线索。
- 无法验证的字段显示 `N/A`，不使用猜测值填空。
- 同期新闻不能自动被写成价格变化的原因。

### 2.6 自动 Catalyst Map

- 每天生成未来 7 天 Tier 1 / Tier 2 催化剂地图。
- 每周第一个交易日额外生成未来 30 天风险地图。
- 同时显示北京时间和美东时间。
- 重点覆盖宏观数据、FOMC、Fed 讲话、Treasury 拍卖与 Quarterly Refunding、公司财报、产业活动、融资、解禁和重大政策节点。

### 2.7 历史状态与信号寿命

- 保存每天的原始证据、计算结果、模型输出、最终决策和 Prompt 版本。
- 自动比较昨天、上周和当前运行的状态变化。
- 跟踪 Price Reaction Function，例如“利好应该上涨但实际不涨”。
- Trigger 后 3–5 个交易日没有 follow-through 自动降级。
- 10 个交易日仍未验证 Thesis 时进入重新研究状态。
- 每周展示 Consensus、Score、Veto 和排名变化。

### 2.8 Bull / Bear Research Debate

- 出现重要新研究时才生成 Research Debate。
- V1 的新研究只来自用户手动录入的结构化证据，不自动搜索、抓取或解析通用研究站点。
- 同时提取 Bear Case 和 Strongest Bull Case。
- 每项研究记录核心 Thesis、三条关键证据、可证伪预测、时间窗口、利益冲突和独立验证状态。
- 研究报告只作为问题线索，必须由 SEC、公司 IR、官方或产业数据复核后才影响高权重 Trigger。

### 2.9 静态执行工具目录

- 底层 Thesis 与执行工具分开建模。
- V1 使用版本化静态名单：SpaceX 重点 `SSPC`，SNDK 重点 `SNDQ`，Nasdaq 重点 `QID`、保守工具 `PSQ`，黄金重点 `GLL`。
- V1 不接入长桥 API，不查询账户、持仓、券商可交易性或自动轮换工具。
- 名单变更必须由用户确认后更新配置，不由模型或行情自动改写。
- 行情源无法提供新鲜报价、成交量或点差时，报告中的执行工具输出 `None`。
- 系统只给出执行候选和底层无效点，不自动提交订单。

### 2.10 AI 故障不影响基础晨报

- Scheduler 先运行并发布现有晨报，再运行 Short Monitor。
- 两段流水线使用独立状态、独立错误和独立运行结果，通过 `marketSnapshotId` 共享已核验的基础行情快照。
- DeepSeek 超时、限流、余额不足、JSON 无效或返回空内容时，现有确定性晨报仍正常生成。
- AI 空头监控显示明确的降级原因和最后一次成功状态。
- 模型失败不会沿用旧结论冒充当天结论。

## 3. 产品边界

### 3.1 V1 要做

- 四方向空头监控
- 项目内 Scheduler
- 官方交易日历
- 结构化证据包
- 确定性指标和硬规则
- DeepSeek 结构化分析
- 历史运行与审计
- 报告页面和手动运行
- 失败降级

### 3.2 V1 不做

- 自动下单
- 自动调整仓位
- 自由访问整个互联网的自主 Agent
- 多 Agent 协作网络
- 向量数据库和通用 RAG
- 长桥或其他券商 API
- 自动读取账户、持仓或可交易权限
- 对 52 只证券逐只进行昂贵的深度 AI 研究
- 用免费低质量数据伪造 sell-side consensus、实时 borrow cost、完整 options skew 或企业级 NAND 合同价格
- 让模型自行计算收益率、均线、ATR、R/R 或 Factor Cluster 分数

### 3.3 现有实现的调整原则

本方案不是在现有晨报旁边简单增加一次 DeepSeek 调用。交易日判断、任务并发、历史状态、缓存可信度和写接口安全会直接影响 AI 结论，因此必须在接入模型前完成基础加固。

现有晨报不整体重写。调整范围集中在：

- 时间与交易日状态
- 任务调度、补跑和防重复
- 历史运行与跨日状态
- 数据新鲜度、缓存降级和来源审计
- 写接口鉴权
- 四个空头方向及其执行工具的数据质量

普通 52 只港美股晨报继续使用现有页面、名单和主要计算逻辑。本轮不借机替换全部行情源，也不对全部证券做昂贵的 AI 深度研究。

### 3.4 当前模块处置矩阵

| 当前能力 | 当前状态 | 本轮处理 | 实施阶段 |
| --- | --- | --- | --- |
| 52 只港美股晨报 | 已有报告、全量表、异动与 Thesis 展示 | 直接复用，保持现有功能不回退 | 全程保护 |
| Universe 搜索与名单维护 | 已有搜索、新增、删除和基准关系 | 复用产品逻辑，补齐统一鉴权 | Batch A |
| 收益率、量比、52 周位置 | 已有确定性计算 | 复用函数并补 fixture；四个空头方向增加均线、ATR、结构位和相对强弱 | Batch B |
| 美股行情 | 新浪日线，腾讯快照，带本地缓存 | 保留为普通晨报来源；四个空头方向增加第二来源、可靠复权和公司行动校验 | Batch A/B |
| 港股行情 | 腾讯日线与快照 | 继续服务现有晨报，不因本方案整体替换 | 不扩张 |
| SEC / HKEX 公告 | 已能发现近期指定公告 | 保留为官方文档发现层；空头监控增加 XBRL、正文和 Evidence 元数据 | Batch B |
| Catalyst | 仅解析官方公告标题中的日期 | 扩展为官方宏观日历、公司 IR、Treasury、产业活动和融资节点 | Batch B |
| Thesis | 静态读取 `data/thesis.json` | 继续服务现有晨报；空头监控使用独立、版本化的策略文件 | Batch B |
| 晨报反向产品 | 已支持 SNK、GLL 日度目标偏差 | 保持现有 `InverseKind` 和计算逻辑不动 | 全程保护 |
| Short Monitor 执行工具 | 尚未实现 | 使用独立静态配置，不接入长桥，不修改晨报 inverse 模型 | Batch A |
| 报告存储 | 只保留最新报告 | 保留 `latest` 入口，新增不可变历史 Run Store | Batch A |
| 任务状态 | JSON 状态文件和一小时存活判断 | 改为原子锁、唯一运行键、补跑和恢复机制 | Batch A |
| 自动运行 | 宿主机 crontab | 改为 Compose 内独立 Scheduler service，先晨报、后 Short Monitor | Batch A |
| 手动生成 | Next.js API 后台触发 | 保留入口；晨报与 Short Monitor 使用各自 Run Lock 和状态 | Batch A |
| 编辑鉴权 | token 未配置时默认放行，部分写路由未统一鉴权 | 改为 fail-closed，所有写操作走同一边界 | Batch A |
| AI 分析 | 尚未接入 | 在数据与运行基础稳定后接入 DeepSeek | Batch B |

### 3.5 Batch A 必须解决的现有问题

#### 交易日与“新数据”判断

当前报告只要取得最后一个行情日期，就会把它视为新的完整交易日；虽然运行结束会保存上一交易日，但生成时没有使用该状态进行比较。周末、全日休市或重复生成时，旧收盘可能再次被解释为新数据。

本轮必须改为：

1. 先使用官方交易日历得到预期 Session。
2. 再检查行情源是否提供该 Session 的完整数据。
3. 与上一次成功运行的 Session 比较。
4. 明确输出 `new / unchanged / closed / early-close / stale / unavailable`。
5. 休市日不得用旧成交量重新生成普通评分。

当前固定按常规 16:00 收市判断的逻辑也必须支持提前收市。

#### 行情缓存与复权

现有缓存、重试和参考标的日期对齐框架可以保留，但需要补足：

- 在线请求失败而使用旧缓存时，显式记录 `stale`、原始错误和最后成功抓取时间。
- 每个 Series 记录 `provider`、`fetchedAt`、`sessionDate`、`adjustmentMode` 和数据缺口。
- 参考标的本身也通过第二来源验证，不能只用 VOO 或 2800.HK 自证日期新鲜。
- 四个空头底层及候选工具使用可靠的拆股、分红和复权数据。
- `SPCX` 只接受当前 SpaceX 普通股正式上市后的底层价格；`SNDK` 只接受当前上市实体或拆分后的底层价格。
- 两个标的都在版本化证券主数据中写明经官方核验的 `officialFirstSession` 和 `historyStartDate`，所有更早 bars 一律丢弃。
- 历史样本不足时，20/50/200DMA、ATR 或其他长周期指标返回 `N/A`，不得拼接旧 ticker、旧实体、ETF 或前身资产历史。
- 普通晨报可以继续使用当前来源，但不得把 stale fallback 当作当天新数据。

本轮不要求一次性替换全部 52 只证券的数据提供方。

#### 运行锁与历史存储

当前“先读取 status，再写入 running”的方式不是原子操作，自动任务和手动任务可能同时通过检查。只保存最新报告也无法支持 Signal TTL、周变化、Price Reaction Function 和历史复盘。

Batch A 必须先实现 Step 2 中的原子锁、唯一日运行键和不可变历史档案，再接入项目内 Scheduler。晨报和 Short Monitor 使用不同的运行键与状态；Short Monitor 只消费晨报发布后的 `marketSnapshotId`。

#### 写接口安全

所有 Universe 修改、手动生成和后续策略修改接口都必须统一为 fail-closed：

- 未配置服务端鉴权信息时拒绝写操作。
- 删除接口与新增接口使用相同鉴权。
- DeepSeek key 仅存在于服务端环境变量或 Secret。
- 页面只获得运行结果，不获得模型密钥或上游数据源密钥。

### 3.6 Batch B 对现有数据拉取的扩展边界

现有 SEC/HKEX 连接器继续承担“发现近期官方公告”的职责，不直接废弃。V1 只维护以下少量 Evidence 连接器：

1. 现有行情源，以及四个底层标的的第二来源日期与身份核验。
2. NYSE / Nasdaq 官方交易日历。
3. SEC submissions、XBRL/companyfacts，以及 SPCX/SNDK 的关键公司 IR。
4. Treasury 与 FRED 的利率、实际利率和少量流动性序列。
5. Fed、BLS、BEA、Treasury 官方催化剂日历。
6. CFTC COT 的黄金持仓数据。

现有 `FactDoc` 需要转换或扩展为带唯一 Evidence ID、发布时间、观察期间、来源层级、抓取时间、stale 和 limitations 的数据结构。

扩展优先服务 SPCX、SNDK、Nasdaq 和 Gold 四个方向。除非某个公共数据连接器可直接复用，否则不把同等深度分析扩张到全部 52 只证券。

FINRA/SEC FTD、EIA/OPEC、通用新闻发现、自动研究报告抓取、预测市场、AIS、运费、保险、options skew、borrow cost、dealer positioning 和 sell-side consensus 均不进入 V1。相关字段明确显示 `N/A / V1 未接入`。

### 3.7 明确暂缓的现有系统改造

以下事项不属于本轮必要优化：

- 重做现有晨报视觉系统
- 重写 Universe 搜索体验
- 更换所有港股行情源
- 为全部 52 只证券建立 AI Thesis
- 接入长桥或其他券商账户
- 动态查询券商可交易性或自动更换执行工具
- 引入 PostgreSQL、Redis、消息队列或向量数据库
- 为了形式统一而重写已经稳定的收益率和量比函数
- 泛化或重构现有晨报的 `InverseKind`
- 接入真实交易下单权限

只有在单机文件 Run Store、独立 Scheduler 和四方向监控出现明确容量或并发瓶颈后，才评估数据库或队列。

## 4. 总体架构

```text
Scheduler Worker
    │
    ├── Pipeline A: Morning Report
    │     ├── Calendar / Market Fetch
    │     ├── Deterministic Morning Calculations
    │     ├── Publish Existing Morning Report
    │     └── Publish verified MarketSnapshot + marketSnapshotId
    │
    └── Pipeline B: Short Monitor
          ├── Consume MarketSnapshot
          ├── V1 Evidence Connectors
          ├── Evidence Normalizer
          ├── Deterministic Feature / Score / R/R Engine
          ├── DeepSeek Tier + Narrative Analyst
          ├── Position-aware Decision Validator
          ├── Immutable Short-monitor Run Store
          └── Report Renderer / API / UI
```

Pipeline A 是早上 09:00 必须先交付的主路径。Pipeline B 只能在 A 已发布晨报和已核验 `MarketSnapshot` 后启动；DeepSeek 或 Short Monitor 失败不得回滚、覆盖或阻塞晨报。两段拥有独立的锁、运行状态、错误和重试记录，只通过带版本的 `MarketSnapshot` 契约关联。

### 4.1 适度解耦原则

- 保留现有 Morning Report 模块与 `InverseKind` 逻辑，不为了 Short Monitor 搬迁或泛化已稳定代码。
- 共享层只放置真正共用的市场时钟、运行锁、HTTP 基础能力和 `MarketSnapshot` 契约，不共享业务决策。
- Short Monitor 消费稳定的 `MarketSnapshot`，不依赖晨报 UI 模型、Markdown 或内部计算过程。
- Source Connector 只负责拉取和标准化；DeepSeek Adapter 只负责调用模型与 Schema 校验；两者都不得计分或选择 Action。
- Score Engine 是无网络、无文件写入的纯函数模块；Decision Validator 单独负责持仓状态、Veto、R/R 和 Action 合法性。
- Renderer 只渲染已确定的结果，不在页面层补计分、改状态或推断交易行为。
- 依赖方向固定为“数据 → 证据/特征 → 模型档位 → 代码决策 → 渲染”，禁止反向依赖和循环引用。
- V1 不引入 DI 容器、事件总线、通用 Agent 框架、通用 Connector DSL 或数据库；只在已经存在的边界抽取小接口。

## 5. 推荐目录结构

以下为实施时建议新增或调整的模块，最终文件名可以按实际代码结构微调：

```text
prompts/short-monitor/
  policy.md
  output-example.json
  assets/
    spcx.md
    sndk.md
    nasdaq.md
    gold.md

lib/short-monitor/
  types.ts
  schema.ts
  pipeline.ts
  evidence.ts
  features.ts
  clusters.ts
  veto.ts
  risk-reward.ts
  decision-validator.ts
  render.ts

lib/shared/
  calendar.ts
  market-snapshot.ts
  run-lock.ts
  http.ts

lib/short-monitor/sources/
  market.ts
  sec.ts
  ir.ts
  macro.ts
  treasury.ts
  positioning.ts

lib/ai/
  deepseek.ts
  short-monitor-analyst.ts

scripts/
  scheduler.ts
  generate-morning.ts
  generate-short-monitor.ts

app/api/short-monitor/
  route.ts
  status/route.ts
  generate/route.ts

components/
  ShortMonitor.tsx

data/short-monitor/
  security-master.json
  execution-tools.json
  positions.json
  latest.json
  state.json
  runs/
```

这是责任边界示意，不要为了匹配目录图强制搬迁现有晨报文件。运行生成物应保存在持久磁盘并排除出 Git；策略、Schema、证券主数据、静态工具名单和 Prompt 版本应进入 Git。

## 6. Step-by-step 实施计划

### Step 0：冻结 V1 口径与验收样例

#### 工作内容

1. 将当前长 Prompt 拆为全局规则和四个资产 Thesis。
2. 把自然语言中的硬规则整理为机器可验证的规则表。
3. 准备九个固定测试场景：
   - 正常交易日且全部 WAIT
   - 全日休市
   - 提前收市
   - 单一利空但无价格确认
   - Score 足够但存在 Veto
   - 完整 Trigger 且 R/R 合格
   - `FLAT` 时模型文本暗示 `REDUCE`，代码校验必须拒绝
   - SPCX/SNDK 在历史切断日之前存在 bars，旧 bars 必须丢弃且样本不足的长周期指标为 `N/A`
   - 晨报成功而 DeepSeek 超时，晨报已发布且 Short Monitor 独立降级
4. 固定 V1 输出 JSON 示例和第一屏文案。

#### 交付物

- `prompts/short-monitor/policy.md`
- 四个资产 Thesis 文件
- 输出 Schema 草案
- 九个验收 fixture

#### 验收标准

- 每个自然语言约束都能归类为数据要求、计算规则、模型判断或最终硬校验。
- 不存在由模型单独决定的强制交易规则。
- 全日休市 fixture 不会把前一交易日的旧成交量当作当日新信号。

### Step 1：建立证券主数据与执行工具映射

#### 工作内容

1. 建立四个底层方向的稳定 ID。
2. 将底层证券与执行工具分离。
3. 在版本化证券主数据中写死底层历史边界：`SPCX.historyStartDate = 2026-06-12`，`SNDK.historyStartDate = 2025-02-24`；同时记录相同的 `officialFirstSession`。实现前必须用交易所或发行人官方资料复核一次，如与常量冲突则 fail closed，不自动向前扩展历史。
4. 价格确认只使用底层 `SPCX`、`SNDK`、`QQQ/NDX` 和 `GLD/XAUUSD`，不使用反向 ETF 自身走势替代底层信号。
5. 新增独立静态工具名单：`SSPC`、`SNDQ`、`QID`、`PSQ`、`GLL`，记录发行人、交易所、杠杆目标、底层资产、费用、日度复位规则和官方产品链接。
6. 底层与工具都必须同时核验腾讯原始返回的证券代码、长名称和产品类型，三者任一缺失、未知或冲突都 fail closed，不得用请求 ticker、短名称或名称正则补齐。执行工具使用独立的必含/禁含身份词，不能复用底层身份词；任一身份核验失败都产生阻断缺口，底层不进入价格特征，工具不进入可执行候选。
7. 不调用长桥 API，不核验账户可交易性，不自动换工具。工具名单仅能由受控配置修改。
8. 现有晨报中的 `SNK` / `GLL` 和 `InverseKind` 保持不动，新名单不回写旧 Universe。

#### 交付物

- `data/short-monitor/security-master.json`
- `data/short-monitor/execution-tools.json`
- 底层历史切断与身份验证测试

#### 验收标准

- Short Monitor 不会把 `SSPC` 与现有晨报的 `SNK` 当作同一产品，也不会修改旧晨报的 inverse 计算。
- SPCX 早于 `2026-06-12`、SNDK 早于 `2025-02-24` 的 bars 都会被丢弃，无论上游 ticker 返回了什么。
- 工具缺少可靠报价时只能输出 `None`。
- 所有止损和趋势判断以底层资产为准，反向 ETF 只负责换算与执行风险展示。

### Step 2：建立不可变运行档案与原子锁

#### 工作内容

1. 每次运行生成唯一 `runId`。
2. Morning Report 与 Short Monitor 使用不同的 `pipelineId` 和唯一日运行键，各自保存不可变运行档案。
3. Short Monitor 的文件档案为：

```text
data/short-monitor/runs/<runId>/
  manifest.json
  evidence.json
  derived.json
  model-output.json
  decision.json
  report.json
```

4. `manifest.json` 记录：
   - 开始与结束时间
   - 数据截止时间
   - 市场状态
   - `pipelineId` 与上游 `marketSnapshotId`
   - Prompt 版本/hash
   - 模型名
   - 数据源状态
   - token usage
   - 缓存命中信息
   - 成功、降级或失败状态
5. `derived.json` 保存每个资产的最小确定性重放快照：历史切断后的样本数、session/stale/price eligibility、last close、20DMA、1 日收益、ATR14、20 日 swing high、target、R/R、受控持仓输入、持有交易日数、生命周期结果、证据簇、Veto、聚类仲裁和最终决策；不必复制整段行情历史。
6. 使用原子文件锁或等价的单写入机制，替换“先读取状态再写入”的竞态流程。
7. 两条流水线有各自的 `latest` 索引和状态，既不共享 running 标记，也不用 AI 结果覆盖晨报结果。

#### 交付物

- Run Store
- Run Lock
- 历史读取接口

#### 验收标准

- 自动任务和手动任务同时触发时只执行一次。
- 进程异常退出后锁能够安全过期或恢复。
- 任意历史报告都能还原它使用的证据和 Prompt 版本。
- 可从 Short Monitor 的 `marketSnapshotId` 追溯到对应晨报的数据截止时间和市场日。

### Step 3：将定时任务放入项目

#### 工作内容

1. 新增独立 Scheduler 进程，不把常驻定时器放进 Next.js 请求生命周期。
2. 在 `docker-compose.yml` 增加 `scheduler` service，与 Web 共用镜像和持久数据卷。
3. Scheduler 每分钟检查北京时间和两条流水线的当天运行记录。
4. 09:00 到达且当天未运行时，先执行 Pipeline A：生成并发布现有晨报，然后固化 `MarketSnapshot`。
5. Pipeline A 成功发布后再启动 Pipeline B：使用该 `marketSnapshotId` 生成 Short Monitor。
6. Pipeline B 失败只记录 AI 降级，不改变晨报的成功状态；Pipeline A 失败时，B 不用旧快照冒充当天结论。
7. 09:00 后服务重启时分别检查 A/B：A 成功而 B 缺失可只补跑 B；A 缺失则从 A 开始。
8. 保留受鉴权保护的手动运行接口，但手动晨报和手动 Short Monitor 使用不同的锁。
9. 删除部署对宿主机 `/etc/cron.d` 的依赖。

#### 交付物

- `scripts/scheduler.ts`
- `npm run scheduler`
- Compose 中的 Scheduler service
- Scheduler 状态与日志

#### 验收标准

- 本地可通过测试时钟验证 09:00 触发。
- 重启可补跑，但不会重复生成。
- 晨报总是先发布，DeepSeek 超时不影响已发布晨报。
- Web 服务重启不会影响正在运行或即将运行的 Scheduler。
- 宿主机不安装 crontab 仍能稳定运行。

### Step 4：实现官方交易日历与数据截止 Gate

#### 工作内容

1. 引入交易日历计算库作为基础日历。
2. 保存并定期更新 NYSE / Nasdaq 官方年度休市与提前收市日期。
3. 每次运行计算：
   - 当前北京时间
   - 当前美东时间
   - 市场日类型
   - 最近完整交易日
   - 是否提前收市
   - 是否为本周第一个交易日
4. 检查各行情源的最新完整日期是否一致。
5. 根据市场日类型选择完整报告、提前收市报告或休市报告。
6. 将 09:00 产物固定标记为 `overnight_snapshot`，价格和成交量只使用最近完整常规交易时段，不根据实时盘前波动重计分。

#### 交付物

- `MarketClock`
- `SessionDecision`
- 日历更新与一致性检查

#### 验收标准

- 不混入盘前、盘后或未完成交易日。
- 报告不会被表述为盘中 desk 或即时成交信号。
- 休市日不会沿用旧成交量生成新的普通盘前评分。
- 提前收市标记会传入成交量与流动性权重计算。
- 日历数据缺失或冲突时任务降级为不可交易状态。

### Step 5：建设结构化 Evidence Packet

#### 工作内容

所有数据源输出统一的 `EvidenceItem`，至少包含：

```ts
type EvidenceItem = {
  id: string;
  asset: "SPCX" | "SNDK" | "NASDAQ" | "GOLD" | "MACRO";
  kind: string;
  observedAt: string;
  publishedAt?: string;
  period?: string;
  sourceTier: 1 | 2 | 3 | 4;
  sourceName: string;
  sourceUrl: string;
  title: string;
  value?: number | string;
  unit?: string;
  summary: string;
  verified: boolean;
  stale: boolean;
  limitations: string[];
};
```

#### 首批数据源

| 数据方向 | V1 来源 | 用途 |
| --- | --- | --- |
| 交易日历 | NYSE、Nasdaq 官方日历 | 休市、提前收市、最近完整交易日 |
| 行情与身份 | 现有行情源 + 四个底层的第二日期/身份来源 | 完整收盘、历史切断、价格确认 |
| 公司公告与基本面 | SEC submissions、XBRL/companyfacts、SPCX/SNDK 关键 IR | 财报、融资、Capex、利润率、供给变化 |
| 宏观与利率 | Treasury、FRED | 名义/实际利率与少量流动性序列 |
| 官方催化日历 | Fed、BLS、BEA、Treasury | 宏观发布、FOMC、Treasury 节点与时区转换 |
| 黄金持仓 | CFTC COT | 报告日与实际持仓日明确的期货持仓 |

#### 数据纪律

- 同一事实由多个转载来源报道时只保留一个事实节点。
- 数据源必须记录时间口径和滞后。
- CFTC COT 必须显示报告日与实际持仓日期。
- 网页正文视为不可信输入，其中的指令不能影响系统 Prompt 或工具权限。
- V1 不从通用搜索结果、媒体摘要或社交媒体自动构造 Evidence。

#### 验收标准

- 每条模型结论都只能引用 Evidence Packet 中存在的 ID。
- 证据来源不可访问时显示缺口，不静默使用旧数据。
- 不同来源的数值冲突时保留冲突并触发 Veto 或降权。

### Step 6：实现确定性特征与风险计算

#### 工作内容

由代码计算以下内容：

1. 价格与趋势：
   - 收益率
   - 成交量比
   - 20/50/200DMA
   - swing high / low
   - ATR
   - breakdown 与反抽
   - 相对 QQQ / SOXX / GLD 等基准强弱
   - 最终 Price Confirmation 档位，不允许模型覆盖
2. Factor Cluster：
   - Inflation Regime
   - Rates Regime
   - Liquidity Regime
   - Oil Supply Shock
   - Equity Supply / Liquidity Drain
3. Veto：
   - 数据矛盾
   - 数据 stale 或历史样本不足
   - 重大二元事件临近
   - 工具行情过期或产品身份未核验
   - 日度杠杆损耗过高
   - Thesis 依赖未验证消息
   - R/R < 2
4. R/R：
   - 以底层资产结构性无效点计算
   - 将底层止损映射到反向 ETF
   - 不使用机械固定百分比止损
5. Cluster Risk：
   - SPCX、SNDK、Nasdaq 是否为同一个 AI/Growth/Rates 交易
   - 同一风险簇只保留 1–2 个最优候选
6. 分数映射：
   - 权重和阈值由版本化代码配置定义，默认为 Fundamental/Earnings 30、Expectations/Valuation 15、Industry/Macro 20、Market Confirmation 25、Catalyst 10。
   - 模型档位只能映射到代码预定的分值，不允许模型提供自定义数值。
   - Factor Cluster 去重、资产专属封顶、Veto 扣减或阻断、R/R 和最终 Score 全部由代码计算。
7. V1 未接入的 short crowding、borrow cost、options skew、dealer positioning 和实时 bid/ask 必须为 `N/A`，既不加分，也不伪造“无风险”结论。

#### 验收标准

- 同一传导链不会重复计分。
- 所有 Score 均可在不调用 DeepSeek 的单元测试中根据输入档位完整复算。
- 模型不能修改原始计算值、权重、阈值或封顶。
- 所有计算均有 fixture 和边界测试。
- 缺少底层止损结构时 R/R 为 `N/A`，不得进入执行候选。

### Step 7：接入 DeepSeek 结构化分析

#### 工作内容

1. 使用服务端环境变量：
   - `DEEPSEEK_API_KEY`
   - `DEEPSEEK_BASE_URL`
   - `DEEPSEEK_MODEL`
2. 静态策略放在消息前缀，动态 Evidence Packet 放在后部，以提高上下文缓存命中机会。
3. 要求模型只输出 JSON，不直接输出最终 Markdown。
4. 输出至少包含：
   - 四个资产的 Consensus / Variant / Falsification / Inflection
   - `NONE / LOW / MEDIUM / HIGH / VERY_HIGH` 的 Fundamental Shift、Expectation Gap、Catalyst Strength 和 Evidence Confidence 档位
   - Price Reaction Function
   - 每个档位和重要叙事对应的 evidence IDs
   - Bull Case / Bear Case
   - Catalyst 解释
   - 缺失数据
5. Schema 明确禁止 `score`、`subscore`、`priceConfirmation`、`action`、`state`、`positionSize` 等字段；叙事中的价格判断或交易指令性文字也不参与决策。
6. 使用运行时 Schema 校验。
7. 将完整输出 JSON 示例直接放入系统消息，禁止仅引用容器内文件名；示例与静态策略一起纳入 Prompt hash 和版本。
8. Schema 只接受冻结字段，未知字段、未知证据 ID 和跨资产证据引用全部拒绝整份输出。
9. JSON 为空、截断或无效时只重试一次。
10. 第二次失败则进入 AI 降级，不生成伪结论。
11. 不保存或展示模型的内部思考文本，只保存最终结构化输出、模型名和 token usage。

#### 验收标准

- API key 不进入浏览器 bundle、日志或数据文件。
- 模型输出无法引用不存在的证据。
- 模型输出中不包含数值 Score 或 Action，最终数值和决策只出现在后续代码产物中。
- 对同一结构化档位 fixture 重放时，最终 Score、状态和硬性 Veto 保持一致。
- DeepSeek 不可用时基础报告仍成功。

### Step 8：实现 Decision Validator 与状态机

#### 工作内容

代码先将经 Schema 校验的枚举档位映射为分项分数，再执行封顶、去重、Veto、R/R、状态和 Action 校验：

1. 状态阈值：
   - `WATCH`：0–49
   - `ARMED`：50–69
   - `CONFIRMING`：70–79
   - `TRIGGERED`：80–100
2. 进入 `TRIGGERED` 必须同时满足：
   - 预期差至少中高
   - 本质变量已变化
   - Price Confirmation 存在
   - Catalyst 明确
   - R/R >= 2
   - 无阻断型 Veto
3. 进入 `ENTER` 还必须满足：
   - Thesis Entry
   - Price Entry
   - Catalyst Entry
4. 只有估值高时 Score 不得超过 40。
5. Nasdaq 至少需要两个独立宏观/盈利变化加一个价格或 breadth 确认，才允许进入 `ARMED`。
6. 黄金至少三个独立驱动同向，才允许显著提高 Score。
7. 外部研究若由用户手动录入，也只能在官方数据独立验证后贡献少量分数；V1 不自动抓取研究报告。
8. 数据缺失、冲突或过期时自动降级。
9. 对已有仓位执行 Signal TTL、Time Stop 和退出阶段规则。
   - Thesis Stop、Price Stop、Time Stop 优先执行。
   - 未触发上述 Stop 但存在阻断数据时输出 `WAIT` 并要求人工复核，不得在数据不可用时自动 `HOLD`。
10. 从受控配置读取 `FLAT / OPEN / UNKNOWN` 持仓状态，严格限定 Action：
    - `FLAT`：`WAIT / PREPARE / ENTER`
    - `OPEN`：`WAIT / HOLD / REDUCE / EXIT`
    - `UNKNOWN`：`WAIT / PREPARE`
11. `ENTER` 只能由代码在 `FLAT` 且全部入场条件成立时产生，09:00 语义固定为“下一常规交易时段的条件候选”。
12. 没有 `OPEN` 持仓时不计算也不渲染 `HOLD / REDUCE / EXIT`。

#### 交付物

- 可审计的 `DecisionResult`
- 每条降级或拦截原因
- 跨日状态机

#### 验收标准

- 任何不合法的档位组合都只能由代码降级为 `PREPARE` 或 `WAIT`。
- `FLAT` fixture 不会产生 `HOLD / REDUCE / EXIT`；`UNKNOWN` 不会产生 `ENTER`。
- 每次降级都能说明具体缺少的条件。
- 状态变化由交易日而非自然日推进。

### Step 9：生成报告与页面

#### 工作内容

1. 新增独立 Short Monitor 视图，不破坏当前晨报。
2. 第一屏展示“隔夜快照”标识、持仓状态、决策卡和四方向状态表。
3. 正文按以下顺序渲染：
   - 今日结论
   - 状态表
   - 今日最重要变化
   - 未来 7 天 Catalyst Map
   - 四方向极简更新
   - 有新研究时的 Research Debate
   - Cluster Risk
   - 最终排名
4. 每周首个交易日增加：
   - 未来 30 天风险地图
   - 一周 Consensus 变化
   - Score 周变化
   - Research Debate 周汇总
5. 支持展开证据、查看缺口和历史对比。
6. 页面显示自动任务状态、最后成功时间、当前运行状态和失败原因。
7. 执行工具只展示受控静态名单的当前候选，明确标注“未连接长桥，未核验账户可交易性”。

#### 验收标准

- 桌面和窄屏均能在第一屏看到 Action、机会、工具、Trigger、Stop、Exit 和 R/R。
- `FLAT` 时页面不出现 `HOLD / REDUCE / EXIT`；09:00 的 `ENTER` 必须带条件候选说明。
- 所有影响决策的文字均可追溯到证据。
- 休市、AI 降级和数据缺口状态有明确视觉区分。
- 现有 52 只晨报仍可正常使用。

### Step 10：安全加固、测试与阿里云上线

#### 安全工作

1. 所有写接口改为 fail-closed 鉴权。
2. Universe 的新增、删除、手动生成和策略修改使用同一服务端鉴权边界。
3. DeepSeek key 只通过阿里云环境变量或 Secret 注入。
4. 数据连接器使用域名白名单、超时、响应大小限制和缓存。
5. 不允许外部文档改变系统规则或调用未授权工具。
6. 不接入交易下单权限。

#### 自动化测试

- Scheduler 时区、两段顺序、分别补跑和防重复测试
- 正常交易、提前收市、休市与“休市不把旧量当新分” fixture
- 单一利空无价格确认 fixture
- SPCX/SNDK 历史切断与长周期指标 `N/A` fixture
- Source connector 解析测试
- Evidence Schema 测试
- 档位到 Score 的确定性映射与 Factor Cluster 去重测试
- Veto、R/R 和状态机测试
- `FLAT / OPEN / UNKNOWN` 的 Action 合法集合测试
- DeepSeek 空响应、非法 JSON、429、5xx 和超时测试
- 晨报成功、DeepSeek 超时时的流水线隔离测试
- 历史状态与 Signal TTL 测试
- 静态工具名单不依赖长桥密钥或账户数据的测试
- Build、lint、类型检查

#### 上线步骤

1. 在本地使用固定 fixture 完成回放。
2. 在阿里云以 shadow mode 运行 5 个美股交易日，只生成报告，不展示执行 Action。
3. 对比人工结论、数据时点、证据引用和状态变化。
4. 修正数据映射或规则后重新开始连续观察窗口。
5. 稳定后开放 WAIT / PREPARE / 状态表。
6. 只有 Trigger 规则连续稳定后，才对 `FLAT` 开放条件式 ENTER，对手动标记为 `OPEN` 的标的开放 HOLD / REDUCE / EXIT。
7. 始终不自动下单。

#### 验收标准

- 连续 5 个交易日无重复任务、漏跑或数据日期错位。
- 任意一次运行都可以从报告追溯到原始证据。
- 晨报在 Short Monitor 之前发布，AI 故障不会使现有晨报不可用。
- 未配置写接口鉴权时服务 fail closed；未配置 DeepSeek key 时只让 Short Monitor 降级，不阻断晨报。

## 7. 模型、Function Tooling、Skills 与 Agent 的最终选择

### V1

- 使用一个 DeepSeek Analyst 调用。
- 数据采集、计分和决策函数由程序固定编排，不开放给模型自由选择。
- Function tooling 只是内部的类型化 TypeScript 边界，不是模型可自主调用的工具集。
- DeepSeek Adapter 只接收 Evidence Packet 并返回枚举档位、证据 ID 和叙事，不接触 Run Store、持仓配置或决策写入。
- 不使用产品运行时 Skills。
- 不使用自主 Agent 循环。
- 不使用向量数据库。
- 不接入长桥或任何券商 Function Tool。

### 后续可选增强

只有在 V1 数据与状态机稳定后，才考虑增加“研究下钻 Agent”：

- 用户点击某一方向的“深入研究”。
- Agent 只能访问白名单内的只读工具。
- 每次最多调用有限次数。
- 输出仍必须引用 Evidence ID 并通过 Decision Validator。
- Agent 不能修改证券名单、策略规则、运行状态或提交订单。

## 8. V1 数据源与不可替代缺口

### 允许自动拉取的来源

V1 的自动 Evidence 源仅限于 Step 5 的六类连接器。其中事实优先级为：

1. SEC / 官方监管
2. 公司 IR
3. NYSE / Nasdaq / ETF 发行人
4. Fed / Treasury / BLS / BEA / CFTC
5. FRED 等有明确口径和发布日的官方或准官方序列

Reuters、Bloomberg、FT、WSJ、sell-side、independent research、预测市场和社交媒体仍然可作为人工研究的线索优先级，但不进入 V1 自动拉取、自动证据或自动计分链路。FINRA/SEC FTD、EIA/OPEC、AIS/保险/运费、options/borrow/dealer 与完整 consensus 数据同样延后。

### 免费数据无法可靠覆盖的字段

以下字段在没有付费或经纪商数据授权时应明确为 `N/A` 或低置信度：

- 完整实时 sell-side consensus revisions
- NDX forward EPS 与 revision breadth
- 实时 borrow cost 和 securities lending utilization
- 完整 options skew 与 dealer positioning
- 高频企业级 NAND 合同价格
- 完整实时 AIS 航运、保险和运费数据
- 精确实时 ETF 全市场资金流

系统不得用社交媒体、搜索摘要或消费级 NAND spot 数据冒充这些字段。

## 9. 完成定义

V1 只有同时满足以下条件才算完成：

- 项目内 Scheduler 稳定运行，先发布晨报、后运行 Short Monitor，两段可独立补跑且防重复。
- 官方交易日历能正确处理正常交易、提前收市和休市。
- 09:00 产物明确标记为隔夜快照，不伪装成盘中 desk 或实时成交信号。
- 四个方向都有可审计的 Evidence Packet。
- 所有数值 Score、指标、Factor Cluster、Veto、R/R、状态和 Action 由确定性代码计算。
- DeepSeek 只输出经 Schema 校验的枚举档位、叙事和有效证据 ID，不输出数值 Score 或 Action。
- Decision Validator 能拦截不满足条件的 `TRIGGERED` 和 `ENTER`。
- `FLAT / OPEN / UNKNOWN` 动作集合受代码强制，无持仓时不产生 `HOLD / REDUCE / EXIT`。
- SPCX 与 SNDK 的底层历史在官方首个常规交易日硬切断，不拼接旧 ticker、前身或 ETF 历史。
- 执行工具使用受控静态名单，不接长桥、不读取账户，不修改现有晨报 inverse 逻辑。
- V1 自动证据源只包含 Step 5 定义的小范围连接器。
- Morning、Short Monitor、Connector、DeepSeek Adapter、Score Engine、Validator 和 Renderer 符合 4.1 的单向依赖边界，没有循环依赖或跨层计分。
- 历史状态、Signal TTL 和周度变化可计算。
- 页面完整展示第一屏决策卡、状态表、Catalyst 和证据。
- AI 或某个数据源失败时能够安全降级。
- 所有写接口 fail-closed，API key 不泄露。
- 现有港美股晨报功能不回退。

## 10. 推荐实施批次

### Batch A：运行基础

- Step 0–4
- 目标：九个 fixture、SPCX/SNDK 历史硬切断、静态工具名单、不可变历史、双流水线 Scheduler 和交易日历稳定。

### Batch B：数据与 AI

- Step 5–8
- 目标：小范围 V1 Evidence Packet、确定性特征/计分、DeepSeek 档位分析和持仓感知 Validator 可回放。

### Batch C：产品化与上线

- Step 9–10
- 目标：页面、历史对比、安全、阿里云 shadow mode 与正式启用。

每个 Batch 完成后先自审差异并运行相关检查；进入下一批前，前一批的数据契约和验收 fixture 应保持稳定。

## 11. 参考资料

- [DeepSeek API](https://api-docs.deepseek.com/)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [DeepSeek Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Nasdaq Trading Calendar](https://www.nasdaqtrader.com/trader.aspx?id=Calendar)
- [Nasdaq：SpaceX 于 2026-06-12 开始 SPCX 交易](https://www.nasdaq.com/newsroom/spacex-ipo-rocket-company-launches-historic-ipo)
- [Sandisk IR：SNDK 于 2025-02-24 开始常规交易](https://investor.sandisk.com/news-releases/news-release-details/sandisk-celebrates-nasdaq-listing-after-completing-separation)
- [FRED API](https://fred.stlouisfed.org/docs/api/fred/)
- [U.S. Treasury Daily Rates](https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml)
- [CFTC Commitments of Traders](https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm)
- [Leverage Shares SSPC](https://leverageshares.com/us/etfs/leverage-shares-2x-short-spcx-daily-etf/)
- [ProShares QID](https://www.proshares.com/our-etfs/leveraged-and-inverse/qid)
- [ProShares PSQ](https://www.proshares.com/our-etfs/leveraged-and-inverse/psq)
- [ProShares GLL](https://www.proshares.com/our-etfs/leveraged-and-inverse/gll)
