# OPEN BOOK（持仓手账）

> 名字三关：open position（未平仓持仓）· 交易员的 book（持仓簿）· open book（一目了然——把分散各平台的账目摊成一页）

跨市场（A股 / 美股 / 港股）个人交易记录与持仓汇总工具。单文件 Web App，手机优先设计，
Safari「添加到主屏幕」后可像原生 App 一样全屏使用。数据仅存本地浏览器，不上传任何服务器。

## 功能

- **记一笔**：按名称/拼音/代码搜索股票（沪深港美），录买入/卖出、价格、数量、手续费、券商、备注；「用现价」一键填入实时价
- **持仓**：移动加权平均成本（含手续费）、实时市值、浮动盈亏、已实现盈亏，全部按当前汇率折算到基准货币（CNY/USD 可切换）
- **统计**：本周 / 本月 / 本年 / 全部 的买入卖出金额、净买入，按股票、按券商分解，**环形图**（本期买入/卖出构成，按股票占比）+ 本年月度买卖柱状图
- **K线**：日/周/月K（前复权）+ MA5/10/20 + 成交量，**自己的买卖点以 B/S 圆标叠加在成交价上**（同日同向合并为 B×2；周末/节假日日期自动对齐到之前最近一根K线），tooltip 显示当笔交易详情
- **汇率**：USDCNY / HKDCNY 实时（腾讯），失败自动降级 er-api 日汇率，再降级备用常数并明确标注
- **备份**：一键导出/导入 JSON；红涨绿跌与绿涨红跌可切换；浅色/深色/跟随系统

## 文件结构

```
index.html      构建产物（部署/打开这个）
parts/          源码分块
  p1.html       HTML 骨架 + 全部 CSS（设计令牌）
  core.js       纯逻辑：持仓计算/统计/汇率换算（可独立单测）
  data.js       本地存储 + 行情/K线/汇率/搜索网络层
  ui.js         渲染 + ECharts 图表 + 交互
  p4.html       收尾标签
```

重新构建：`cat parts/p1.html parts/core.js parts/data.js parts/ui.js parts/p4.html > index.html`

## 部署到 iPhone

1. **同 Wi-Fi 临时试用**：Mac 上 `python3 -m http.server 8765`，手机 Safari 访问 `http://<Mac局域网IP>:8765`（Mac 需保持开机）
2. **长期使用（推荐）**：把 `index.html` 放到任意静态托管（GitHub Pages / Cloudflare Pages / 自己的服务器），HTTPS 下 Safari 分享 → 添加到主屏幕
3. 换部署地址后，用「设置 → 导出备份 / 导入备份」迁移数据

## 数据接口（均为公开免费接口，国内直连）

| 用途 | 接口 |
|---|---|
| A股/港股实时行情 + 汇率 | `qt.gtimg.cn/q=sh600519,whUSDCNY`（GBK，已带 CORS `*`） |
| K线（日/周/月，前复权） | `web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,,,250,qfq`（自带美股报价，美股延时约15分钟） |
| 股票搜索 | `smartbox.gtimg.cn/s3/?v=2&q=..&t=all`（JSONP） |
| 汇率兜底 | `open.er-api.com/v6/latest/USD` |

## 口径说明

- 成本 = 移动加权平均，手续费计入；卖出即时结转已实现盈亏
- 账本多空对称：先卖后买（做空或补录历史交易）与先买后卖结果一致
- 统计中的外币金额按**当前**汇率折算（界面有标注）
- 美股交易所后缀（.OQ/.N）自动探测：错误后缀只返回 1 根K线，以此判断

## 已验证

- 核心账本逻辑单测全部通过（`node` 直接跑 `parts/core.js`；含多空对称、顺序无关性）
- ECharts SSR 渲染级测试：B/S markPoint 在 SVG 中真实绘制（含 B×2 合并）
- Chrome DevTools 协议交互测试：统计周期 tab 连续切换、环形图/柱状图/K线画布、详情页交易列表均正常
- 网络请求 net-log 实证：加载时发出 `qt.gtimg.cn`（行情+汇率单次批量）、`web.ifzq.gtimg.cn`（K线/美股报价）、cdnjs（图表库）
- 调试钩子：`window.__cj.kChart / .stChart / .stDonut / .S`（浏览器控制台只读）
