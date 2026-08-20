# Nasdaq-100 / QQQ / NDX

## Thesis

空头监控跟踪纳指成长股盈利修正、利率/流动性体制与广度恶化是否相对共识形成可交易预期差。禁止因估值贵或涨多直接做空；必须多因子独立确认。

## 本质变量变化（计入 Fundamental Shift）

- 至少一个独立宏观体制变化（利率、实际利率、流动性、通胀）被官方序列证实
- 至少一个独立盈利/预期变化（财报季指引恶化、广度恶化的可核验代理）；完整 sell-side consensus 为 N/A 时不得伪造
- 二者须可区分为不同 Factor Cluster，避免同一传导链重复计分

不算本质变化：估值分位高、年内涨幅、单条科技利空、战争标题、单一均线破位、单一研报。

## 结构性无效（Stop / Invalidation）

- 底层 QQQ/NDX 收复关键结构高点或空头结构破坏
- 宏观与盈利驱动同时反转并被价格/breadth 确认
- 数据 stale、冲突或日历休市导致不可交易

## 催化剂类型

- FOMC、Fed 讲话、Treasury 拍卖/Refunding、BLS/BEA 官方发布
- 权重股财报与指引窗口（作催化剂解释，高权重仍须官方数据）
- 广度/相对强弱由代码特征层计算，模型只给叙事档位

## 资产专属规则

- **ARMED 门槛**：至少 2 个独立宏观/盈利变化 + 1 个价格或 breadth 确认，否则不得进入 ARMED
- 估值-only Score 封顶 40
- 无 historyStartDate 硬切断（用完整可核验日线）；仍须第二来源日期一致
- 执行工具：`QID`（主）、`PSQ`（保守）；静态名单；缺报价 → None
- 价格确认仅用底层 QQQ/NDX，不用 QID/PSQ 走势替代
- short crowding / borrow / options skew：V1 = `N/A`
