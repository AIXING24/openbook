# OPEN BOOK

跨市场（A股 / 美股 / 港股）个人交易记录与持仓汇总工具。单文件 Web App，手机优先设计，
Safari「添加到主屏幕」后可像原生 App 一样全屏使用。数据仅存本地浏览器，不上传任何服务器。

## 功能

- **记一笔**：按名称/拼音/代码搜索股票（沪深港美），录买入/卖出、价格、数量、手续费、券商、备注；「用现价」一键填入实时价
- **持仓**：移动加权平均成本（含手续费）、实时市值、浮动盈亏、已实现盈亏，全部按当前汇率折算到基准货币（CNY/USD 可切换）
- **统计**：本周 / 本月 / 本年 / 全部 的买入卖出金额、净买入，按股票、按券商分解，**环形图**（本期买入/卖出构成，按股票占比）+ 本年月度买卖柱状图
- **K线**：日/周/月K（前复权）+ MA5/10/20 + 成交量，**自己的买卖点以 B/S 圆标叠加在成交价上**（同日同向合并为 B×2；周末/节假日日期自动对齐到之前最近一根K线），tooltip 显示当笔交易详情
- **汇率**：USDCNY / HKDCNY 实时（腾讯），失败自动降级 er-api 日汇率，再降级备用常数并明确标注
- **备份**：一键导出/导入 JSON；红涨绿跌与绿涨红跌可切换；浅色/深色/跟随系统

## 主屏幕安全区域兼容与临时底栏诊断（v1.14.5-diag3）

真机报告确认 `navigator.standalone=true`、`display-mode: standalone=false` 同时存在，
导致旧版 JS 跳过高度管理，而只依赖媒体查询的固定底栏 CSS 没有启用，实际仍为 `static`。
diag2 统一模式识别后，真机已确认底栏为 fixed，但启动视口仍在874和812之间切换，最后缩小62px；横屏再转回可恢复。
本版保留统一模式识别，将 `viewport-fit` 改为 `contain`、状态栏样式改为 `default`，
作为避开透明状态栏全屏延伸的兼容候选，让系统管理可用安全区域。顶部状态栏外观与内容起点会有所变化。
该方向参考 [WebKit 237961](https://bugs.webkit.org/show_bug.cgi?id=237961) 和
[WebKit 254868](https://bugs.webkit.org/show_bug.cgi?id=254868) 的同类问题，不表示已证实相同内部原因或通过真机回归。
不硬补62px，不用 screen.height 强制设置页面高度；保留诊断等待原主屏幕入口验证。
构建标识为 `layout-20261111-03`，可在设置页和诊断报告中核对，避免仅靠旧的 v1.14 标签判断缓存版本。

1. 从原来的手机主屏幕图标进入，先确认设置页版本是 `v1.14.5-diag3`。
2. 底栏异常时，先不要关闭应用；进入「设置 → 临时布局诊断 → 查看/复制」，复制报告。
3. 横屏再转回或关闭重进恢复正常后，再复制一份报告，将同新版的异常、正常两份报告分别提供。
4. 「清除记录」只影响诊断，不影响交易、行情、偏好或备份。收集两份报告之前不要清除记录。

诊断在页面主体和底栏创建后、ECharts 加载及账本初始化前开始；保留启动、前后台切换、
视口变化和导航切换前后的测量，最多保存三次打开、每次60条样本，其中最初12条与首次大间距样本单独保留。
记录写入独立的 `localStorage` 键 `cj.layout-debug.v1`，不读取或记录持仓、交易、金额、输入值、
网页地址或网络数据，不自动上传。只记录 iOS 版本号，不记录完整浏览器标识。
存储被禁用或写入失败时，本次打开仍可复制内存报告，但关闭后不能保证保留。

`safeAreaTop` 是应用外壳实际计算出的 `padding-top`，`safeAreaBottom` 是底栏实际计算出的 `padding-bottom`（现有 CSS 中来自安全区），
`layoutGap`/`visualGap` 是底栏外框与布局/可见视口底部的距离，`innerGap` 是底栏外框与内层导航的距离。
`firstLargeGap` 只是首次超过采样阈值的现场，键盘、缩放等正常行为也可能触发，不是故障判定。
`standaloneApplied` 记录统一的 CSS 模式标记；旧版历史中未采集该字段时为 null。
每次打开记录页面请求的 `viewportFit` 和 `statusBarStyle`，只保存白名单配置值；旧版历史中缺失时为 null。
这些配置值不证明已安装图标的原生壳实际采用了该状态栏样式。诊断历史读取上限调为400000字符，以容纳三次完整打开的新增字段。
两个 gap 均为0也不能证明真机正常：若可见视口本身处于异常尺寸，需与同设备正常报告比较。
安全区域模式下视口小于 screen.height 可能是正常的系统留边，不能与旧全屏模式的874px直接比较或机械补齐。
诊断读取布局有少量开销；即使加入后暂时不再出现，也需要进一步验证，不能宣称已修复。

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

**线上地址（GitHub Pages，已部署）：<https://aixing24.github.io/openbook/>**

iPhone Safari 打开 → 分享 → 添加到主屏幕，即可像 App 一样全屏使用。任何网络可用（若国内直连失败，可试 Cloudflare Pages 等备选托管）。

备用方案：

1. **同 Wi-Fi 临时试用**：Mac 上 `python3 -m http.server 8765`，手机 Safari 访问 `http://<Mac局域网IP>:8765`（Mac 需保持开机）
2. **更新发布**：修改 parts/ 后 `cat parts/p1.html parts/core.js parts/data.js parts/ui.js parts/p4.html > index.html && git add -A && git commit --no-verify -m "..." && git push`，GitHub Pages 约 1 分钟后自动生效
3. 换部署地址后，用「设置 → 导出备份 / 导入备份」迁移数据

## 数据接口（均为公开免费接口，国内直连）

| 用途 | 接口 |
|---|---|
| A股/港股实时行情 + 汇率 | `qt.gtimg.cn/q=sh600519,whUSDCNY`（GBK，已带 CORS `*`） |
| K线（日/周/月，前复权） | `web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,,,250,qfq`（自带美股报价，**交易时段内实测实时**，qt[0]标记 real/delay 对应开市/休市） |
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
