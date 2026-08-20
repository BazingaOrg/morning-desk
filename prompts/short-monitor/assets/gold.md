# Gold / XAUUSD / GLD

## Thesis

空头监控跟踪实际利率、美元流动性、官方持仓与避险溢价是否同时削弱黄金多头叙事。单一地缘标题或单一技术信号不得抬升空头 Score。

## 本质变量变化（计入 Fundamental Shift）

独立驱动示例（显著抬分需至少三个同向）：

1. 实际利率上行（Treasury / FRED）
2. 美元流动性/名义利率体制转向不利黄金
3. CFTC COT 黄金净持仓与报告日/持仓日口径下的可核验转向
4. 官方宏观日历证实的通胀/增长数据改变实际利率路径

不算本质变化：战争/地缘单标题、估值类比、单一均线、单篇研报、ETF 资金流传闻（无官方序列时 N/A）。

## 结构性无效（Stop / Invalidation）

- 底层 GLD/XAUUSD 收复关键 swing high / 空头结构破坏
- 实际利率或 COT 驱动反转且价格确认
- COT 或利率序列 stale/冲突 → 降权或 Veto，不得用旧持仓冒充新信号

## 催化剂类型

- FOMC、CPI/PCE、Treasury 节点、Fed 沟通
- CFTC COT 发布（必须同时展示报告日与实际持仓日）
- 地缘事件仅作叙事背景，不得单独作为 Catalyst Strength 高档依据

## 资产专属规则

- **显著抬分**：至少 3 个独立驱动同向，否则限制 Score 上调幅度
- 估值-only 不适用时仍遵守全局「禁止单因子做空」；若走估值类比路径则封顶 40
- 无 SPCX/SNDK 式 history 硬切断；COT 与利率必须有明确滞后口径
- 执行工具：`GLL`（静态；不接长桥；缺报价 → None）
- 价格确认仅用底层 GLD/XAUUSD
- 不修改晨报已有 GLL InverseKind 计算逻辑；Short Monitor 使用独立静态工具配置
