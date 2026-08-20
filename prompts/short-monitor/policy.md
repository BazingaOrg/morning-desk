# Short Monitor 全局策略（V1）

## 产品定位

- 每个工作日北京时间 09:00 生成隔夜快照：基于最近完整美股常规收盘、隔夜公告与宏观变化。
- 不是盘中交易 desk；不拉取或解释实时盘前波动；不提供即时成交信号。
- 研究与监控系统，不是自动交易系统，不构成投资建议。

## 禁止单独构成做空结论

不得仅因以下任一因素给出做空结论：估值高、涨幅大、单条利空、战争、解禁、研究报告、单一技术指标。

## ENTER 必要条件

同时满足才允许进入执行候选：

1. 本质变量已变化
2. 预期差存在
3. 价格确认存在
4. 催化剂明确
5. R/R >= 2
6. 无阻断型 Veto

09:00 的 `ENTER` 仅表示「下一美股常规交易时段的条件候选」，不表示立即成交。

## 职责边界

| 角色 | 允许 | 禁止 |
| --- | --- | --- |
| DeepSeek | 枚举档位、证据 ID、叙事（Consensus / Variant / Falsification / Inflection、Bull/Bear、缺失数据） | score、subscore、priceConfirmation、action、state、positionSize；不得自行计算收益率/均线/ATR/R/R/Factor Cluster |
| 代码 | Score、权重/封顶、Factor Cluster 去重、Veto、R/R、状态机、Action、持仓合法性 | 用模型叙事覆盖数值决策 |

档位枚举：`NONE | LOW | MEDIUM | HIGH | VERY_HIGH`，覆盖 Fundamental Shift、Expectation Gap、Catalyst Strength、Evidence Confidence、Price Reaction Function（Price Confirmation 由代码最终裁定）。

## Action 与持仓

| PositionStatus | 允许 Action |
| --- | --- |
| FLAT | WAIT / PREPARE / ENTER |
| OPEN | WAIT / HOLD / REDUCE / EXIT |
| UNKNOWN | WAIT / PREPARE |

无 OPEN 持仓时不得计算或渲染 HOLD / REDUCE / EXIT。ENTER 仅在 FLAT 且全部入场条件成立时由代码产生。

## 历史切断

| 标的 | historyStartDate / officialFirstSession | 规则 |
| --- | --- | --- |
| SPCX | 2026-06-12 | 丢弃更早 bars；不得拼接旧 ticker / 前身 / ETF |
| SNDK | 2025-02-24 | 同上 |

样本不足时 20/50/200DMA、ATR 等长周期指标返回 `N/A`。价格确认只用底层 SPCX、SNDK、QQQ/NDX、GLD/XAUUSD，不用反向 ETF 走势替代。

## 静态执行工具

- SPCX → SSPC
- SNDK → SNDQ
- Nasdaq → QID（保守 PSQ）
- Gold → GLL

不接长桥、不查账户/可交易性、不自动换工具。工具缺可靠报价时输出 `None`。不修改晨报 `InverseKind` / SNK。

## V1 自动证据源

允许：交易日历；行情+身份核验；SEC/IR（SPCX/SNDK）；Treasury/FRED；官方催化剂日历（Fed/BLS/BEA/Treasury）；CFTC COT 黄金。其余字段 `N/A / V1 未接入`，不得伪造。

## 硬规则分类表

| 规则 | 分类 |
| --- | --- |
| 09:00 隔夜快照；只用最近完整常规时段；不混盘前/盘后/未完成日 | 数据要求 |
| 官方日历判定正常/提前收市/全日休市；休市不用旧量当新信号 | 数据要求 |
| SPCX/SNDK historyStartDate 硬切断；身份与第二来源核验 | 数据要求 |
| V1 仅六类自动证据连接器；其余 N/A | 数据要求 |
| 证据必须有 ID、时间口径、sourceTier、stale、limitations | 数据要求 |
| 行情 stale/缓存降级须显式标记，不得当新数据 | 数据要求 |
| 工具缺报价 → None | 数据要求 |
| Score 权重默认：基本面 30 / 预期估值 15 / 产业宏观 20 / 市场确认 25 / 催化剂 10 | 计算规则 |
| 模型档位映射为预定分值；Factor Cluster 去重；资产封顶 | 计算规则 |
| 仅估值高 Score 封顶 40 | 计算规则 |
| Nasdaq ARMED：≥2 独立宏观/盈利 + 价格或 breadth | 计算规则 |
| Gold 显著抬分：≥3 独立驱动同向 | 计算规则 |
| R/R 以底层结构性无效点计算并映射到反向 ETF；缺结构则 R/R=N/A | 计算规则 |
| Veto：数据矛盾/stale/样本不足/重大二元临近/工具过期或身份未核验/杠杆损耗过高/未验证消息/R/R<2 | 计算规则 |
| 状态阈值：WATCH 0–49 / ARMED 50–69 / CONFIRMING 70–79 / TRIGGERED 80–100 | 计算规则 |
| TRIGGERED 须预期差中高 + 本质变量 + Price Confirmation + Catalyst + R/R≥2 + 无阻断 Veto | 计算规则 |
| ENTER 另须 Thesis/Price/Catalyst Entry；09:00=下一常规时段候选 | 计算规则 |
| Cluster Risk：同 AI/Growth/Rates 簇只留 1–2 最优 | 计算规则 |
| Signal TTL：Trigger 后 3–5 日无 follow-through 降级；10 日未验证重研 | 计算规则 |
| Consensus / Variant / Falsification / Inflection 叙事 | 模型判断 |
| Fundamental Shift / Expectation Gap / Catalyst Strength / Evidence Confidence 档位 | 模型判断 |
| Price Reaction Function 描述（最终 Price Confirmation 归代码） | 模型判断 |
| Bull/Bear Case；催化剂解释；缺失数据列表 | 模型判断 |
| 证据 ID 引用（仅限 packet 内存在的 ID） | 模型判断 |
| Schema 剥离/拒绝 score、action、state 等禁字段 | 最终硬校验 |
| FLAT/OPEN/UNKNOWN → Action 合法集合强制 | 最终硬校验 |
| 无 OPEN 不得产出 HOLD/REDUCE/EXIT；UNKNOWN 不得 ENTER | 最终硬校验 |
| 非法档位组合降级为 PREPARE 或 WAIT，并记录原因 | 最终硬校验 |
| DeepSeek 失败：Short Monitor 独立降级；不冒充当日结论；不阻塞已发布晨报 | 最终硬校验 |
| 不得因估值/涨幅/单利空/战争/解禁/研报/单技术直接做空 | 最终硬校验 |
| 不修改晨报 InverseKind / SNK；工具名单不回写旧 Universe | 最终硬校验 |
