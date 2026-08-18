# 港美股晨间追踪

工作日北京时间 09:00 的港美股晨报。用来判断市场是否在重新定价、持有逻辑是否需要复核。**不构成买卖或仓位建议。**

覆盖 52 只证券（美股 / ETF 45 + 港股 7），不含 A 股。

## 本地

```bash
npm install
npm run generate   # 拉取最近完整交易日，写入 data/
npm run dev        # http://localhost:3000
```

首次生成约 1–2 分钟。只保留最新一份（`data/latest.json`），1D / 10D / YTD 每次按最新完整收盘重算。页面只展示，不提供手动生成。

## 每天 09:00 自动生成

必须跑在**有持久磁盘**的机器上（本机、NAS、阿里云均可）。生成结果写在 `data/`，无盘环境（如默认 Vercel）留不住。

时间固定 `Asia/Shanghai` 09:00，工作日，不随美国夏令时改点。

**Linux / 阿里云（推荐，与仓库 `deploy/crontab` 一致）：**

```bash
# 项目放在 /opt/morning-desk，且已 docker compose up -d
sudo cp deploy/crontab /etc/cron.d/morning-desk
sudo chmod 644 /etc/cron.d/morning-desk
```

不用 Docker 时，crontab 改为：

```cron
0 9 * * 1-5 TZ=Asia/Shanghai cd /opt/morning-desk && /usr/bin/npm run generate >> /var/log/morning-desk-generate.log 2>&1
```

**macOS（本机常开）：**

```bash
crontab -e
# 写入：
0 9 * * 1-5 export TZ=Asia/Shanghai; cd /path/to/morning-desk && /usr/local/bin/npm run generate >> /tmp/morning-desk.log 2>&1
```

机器休眠则不会触发。需要 7×24 就放到云服务器。

## 部署站点

站点与定时任务放同一台有盘机器。Cloudflare 只做 DNS。

```bash
cd /opt/morning-desk
docker compose up -d --build
docker compose exec app npm run generate
```

反代见 `deploy/nginx.conf`。Cloudflare：`A` 记录指到服务器 IP，SSL 用 **Full (strict)**（机器上已配置 HTTPS 时）。安全组放行 80、443。

## 口径

| 项目 | 规则 |
| --- | --- |
| 行情 | 美股：新浪日线；港股：腾讯日线。只用已完成正式交易日 |
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
