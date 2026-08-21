# 港美股晨间追踪

工作日北京时间 09:00 的港美股晨报。用来判断市场是否在重新定价、持有逻辑是否需要复核。**不构成买卖或仓位建议。**

覆盖 52 只证券（美股 / ETF 45 + 港股 7），不含 A 股。

## 本地

```bash
npm install
npm run generate   # 拉取最近完整交易日，写入 data/
npm run dev        # http://localhost:3000
```

首次生成约 1–2 分钟。`data/latest.json` 是晨报最新入口；每次成功运行同时保存到 `data/runs/morning/<runId>/`，可由 `marketSnapshotId` 追溯。Short Monitor 首次消费快照时会冻结对应 Evidence Packet，失败重试不会混入之后发布的数据。1D / 10D / YTD 每次按最新完整收盘重算。

## 每天 09:00 自动生成

必须跑在**有持久磁盘**的机器上（本机、NAS、阿里云均可）。生成结果写在 `data/`，无盘环境（如默认 Vercel）留不住。

时间固定 `Asia/Shanghai` 09:00，工作日。由 Compose 里的 `scheduler` 服务触发：先出晨报，再跑空头监控。不要再装宿主机 crontab，也不要和 scheduler 同时跑 `npm run generate`。

若这台机器以前装过仓库里的 cron，上线前卸掉：

```bash
sudo rm -f /etc/cron.d/morning-desk
```

需要 7×24 就把站点放到云服务器。机器休眠则 scheduler 不会触发。

## 部署站点

站点与 scheduler 放同一台有盘机器。Cloudflare 只做 DNS。在项目根 `.env` 配置：

```dotenv
DESK_EDIT_TOKEN=名单写入口令
DEEPSEEK_API_KEY=你的DeepSeekKey
FRED_API_KEY=可选的FREDKey
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

`DESK_EDIT_TOKEN` 未配置时名单写入 fail closed；`DEEPSEEK_API_KEY` 未配置时空头报告降级为 WAIT；`FRED_API_KEY` 未配置时利率证据记为缺口，不阻断晨报。

```bash
cd /opt/morning-desk
# 若曾安装宿主机 cron：
sudo rm -f /etc/cron.d/morning-desk
docker compose up -d --build
```

反代见 `deploy/nginx.conf`。Cloudflare：`A` 记录指到服务器 IP，SSL 用 **Full (strict)**（机器上已配置 HTTPS 时）。安全组放行 80、443。

## 口径

| 项目 | 规则 |
| --- | --- |
| 行情 | 普通晨报美股使用新浪日线、港股使用腾讯日线；空头底层使用 Yahoo Chart 复权 OHLC 并冻结进 Morning Snapshot，再用腾讯原始代码、长名称、类型、日期与价格做第二来源校验；任一关键链路无法核验即阻断 |
| 公告 | 美股 SEC EDGAR；港股 HKEX 披露易。对不上原文则不写原因 |
| 收益 | 1D / 10D 按交易日；YTD 相对上年最后交易日；新上市改列「上市以来」 |
| 量比 | 当日成交量 ÷ 此前 20 个交易日均量 |
| 超额 | 个股区间收益 − 同期主基准 |
| SNK / GLL | 只解释当日相对 −2x 目标的偏差，不把多日收益当成线性 −2 倍 |
| Thesis | 只读 `data/thesis.json`，不因涨跌改写 |

```json
"NVDA": {
  "thesis": "半导体贝塔的核心持仓。",
  "status": "→未变",
  "review": "正常跟踪"
}
```

- `status`：`↑强化` / `→未变` / `↓削弱` / `？未建立`
- `review`：`正常跟踪` / `重点关注` / `重新评估`
