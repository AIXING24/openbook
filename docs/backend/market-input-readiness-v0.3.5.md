# 真实日终输入：v0.3.5候选核查

核查日期2026-11-25。源码与验证属于候选，云端Worker仍v0.3.4、Pages仍client v0.2.0、原App/main仍v1.16.0。本轮没有部署、真实行情写库、真实账本迁移、账号注册或付款。

## 1. 现有数据不能直接当收盘记录

`parts/data.js`的`fetchKline`默认请求`qfq`，并在缺少qfq系列时退回`day`；`usQuote`读取qt实时字段，不保留行情自身的时间。`parts/ui.js`写入的ts是本机接收时间，不是已确认收盘时间。现有`calcAdjEvents`通过价格比值估计事件，不是完整、官方企业行动证据。后台必须使用显式未复权日价、明确市场交易日及可追溯来源，不能把现价、HTTP200或请求发生在收盘后当作足够的最终证据。

[公开样例探测](../../backend/market-source-probes-v0.3.5.json)：沪股600519、港股00700、美股NVDA.OQ均取得400条显式`day`历史行，最早分别为2025-04-03、04-14、04-24；最后日期分别为2026-11-25、11-25、11-24。这证明这些样例的接口覆盖，不证明全股票覆盖、稳定性、最终收盘标志或云端保存/展示许可。港股和美股请求qfq时没有返回显式qfqday，不能因HTTP200就声称已取到前复权序列。报告不发布完整价格序列，不把任何行写为真实已确认点。

## 2. 官方数据服务与免费边界

| 候选 | 本次一手核查 | 当前结论 |
| --- | --- | --- |
| 腾讯现用接口 | 样例请求可取得未复权day；未核定公开官方接口契约、后台储存许可与完整企业行动 | 继续只读旁路观察，不直接审批生产源 |
| [Alpha Vantage文档][AV-D]与[Support][AV-S] | TIME_SERIES_DAILY为raw/as-traded；免费compact仅最近100点，full需要premium。Support写25次API/日；已验证开源/教育项目的例外不能默认授予本仓库 | 默认免费配置不能承诺首次回补一年、50标的每日覆盖。个人非商业许可见[官方条款PDF][AV-T]§2；没有申请key或特殊额度 |
| [Twelve Data Pricing][TD-P] | Basic详情8 credits/min、800/day，当前页面同项写Internal non-display usage：仅testing/evaluation/development，不得向用户显示、对外分享或用于production | 调用额度够不等于允许本工具生产展示，不直接作为免费上线方案；未注册 |
| [Massive Stocks定价][MS-P] | 官方页面自身序列化plan记录Stocks Basic：$0、personal、5 API/min、2年历史、End of Day、US股票、corporate actions/reference可用；不是实时quote套餐 | 后续用户已注册并安全配置key；NVDA摘要、一年251条未复权日线、4条拆股与4条分红请求均HTTP200。仅个人美股候选，完整性/最终性/云端CPU仍未核定，见[实测](massive-free-validation-v0.3.5.md) |

[Massive个人条款][MS-T]适用于free/paid个人非商业用途；引用的[Market Data Terms][MS-M]§1允许本人分析/投资使用任意软件工具，但不允许分享数据或开发/提供给其他用户的服务。第三方行情许可、非专业订阅人资格及订单条款另有要求。首批只能针对用户个人白名单账本，不用一个个人key给整个公开App或多个用户供行情。注册及条款/资格声明由用户自行完成；不代作资格声明，不开收费功能。是否要求付款信息尚未经注册流程验证，若出现付款/卡信息要求，应停止。

[Massive Daily Ticker Summary][MS-C]单独提供close、preMarket、afterHours，需选close；其adjusted默认true（拆股调整），必须显式false且记录请求口径。这里只核读文档，没有用无key请求冒充真实付费/免费接口验收。自由抓取网页不等于取得数据再分发许可。

## 3. 免费历史参考汇率

[ECB官方说明][ECB-R]：参考汇率通常工作日约16:00 CET更新，TARGET休市日除外，基于欧洲央行间日常协调；只供信息参考，强烈不建议直接用于交易成交。报价基准EUR，需交叉换算：`USDCNY=EURCNY/EURUSD`、`HKDCNY=EURCNY/EURHKD`。它不是银行实际换汇价或美股精确收盘汇率，应标明参考口径，不能自动把旧快照的实时/备用汇率改成ECB参考历史值。[ECB版权与免责声明][ECB-L]要求标明来源，修改应明确说明；此处交叉换算是衍生处理。

[一年只读核验](../../backend/ecb-history-audit-v0.3.5.json)：2025-11-25至2026-11-24，765条观测、255个参考日期，三个货币均完整且逐日转换为有限正值。它不是365个自然日均有新FX；周末/TARGET休市沿用哪一天必须有明确日历证据，不能任意选择旧汇率。

`ecb-fx.mjs`每次仅解析一日期3条观测，输入≤24KB、≤25行、≤40列。核对EUR基准、D频率、SP00/A键、指定日期、货币集合、OBS_STATUS与正数；CSV引号/逗号、缺失/重复日期、非数值及跨率溢出均拒绝。OBS_CONF未解释成“最终收盘”，不会把参考日误称成交时刻。整年169KB的分组是离线Node审核，不是Worker的10msCPU结果。Node本机ECB证书链未识别，审核使用严格验证TLS的系统curl；未关闭证书校验，Cloudflare至ECB连通性仍待验。

## 4. 候选日终口径与输入接口

[官方日历核查](market-calendar-sources-2026-11-25.md)包含NYSE/Nasdaq感恩节休市、早收市、DST和港股CAS窗口。深交所年度公告正文仍缺，未知日期不自动复制沪市或互联互通日历。IANA转换处理America/New_York而非固定UTC偏移；CAS证券用窗口末端作为保守可用边界，非CAS证券另核机制，不能视为所有港股都16:10收市。窗口边界不是实际随机成交的精确时间戳。

候选每日标签D：对应各市场当地交易日D，**次日北京时间07:00（D 23:00UTC）之后**才允许检验输入。它覆盖普通美股冬/夏收盘与早收市，仍需数据就绪，不能定时一到就硬确认。休市价明确沿用经核定的上一交易日并带来源日；当日外汇可能仍变动，不能承诺周末整体盈亏必定完全不变。

接口`assessValuationEvidence`只评估日期、时钟、≤50个标的、来源审批、明确日历/未复权常规收盘记录、ECB参考日及已核对企业行动；缺口返回pending与具体原因，完整返回verified-candidate，**不写库、不调网络、不批准数据许可**。来源审批和日历/企业行动证据必须来自受控服务端配置与采集，未来接口不能把浏览器传来的approvedProviders/status当授权。当前根本没有开放该HTTP路由或给生产provider审批。

不同港股可用证券级日历条目覆盖市场默认CAS机制；同一市场/日期/边界的时区转换在一次评估中复用，减少重复Intl调用。启动ICU/50标的的真实免费CPU和冷启动仍待独立云采样，不沿用v0.3.4的7.926ms作为本候选证据。

交易日期迁移特别边界：旧记录只有用户输入date和录入/排序ts；ts不可靠等于执行时刻。北京时间午夜后的美股记录可能属于纽约前一日。不能静默减一天，须在迁移摘要标出歧义，由用户确认原日期含义或对照券商记录；不是要求所有交易重新录入。未确认时门禁保持pending。

原算法的分红处理保持不变。拆股、分红等先核对持股变化和已录入分红，不能自动额外记一笔导致双计；事件覆盖未知或未对账时不确认历史。未实现自动全量企业行动、应收/税费流水，也不把可访问SEC申报等同完整事件库。

## 5. 下一步与上线边界

最终89项后端检查通过、0失败，包括本机原生Workerd时区/FX与来源拒绝、港股CAS/非CAS混合标的，以及原认证/同步/模拟Cron回归。新增模块语法和差异空白检查通过。本轮只提交开发分支，不部署或开启真实Cron。

2026-11-25后续：用户已主动完成免费账户注册，已在其官方账户的Plans & Upgrades页面实读Stocks Basic、Individual、$0/m。此记录只确认套餐状态，不代表所有API已经验收或许可已覆盖公开多用户App。原App仍使用腾讯；Massive是个人美股候选，不是迁移后端必须注册的服务，也不替代A/H来源。

后续用户已安全配置key，个人美股NVDA的4类只读请求均通过，并验证最后一根日线`c`与摘要`close`一致。新增21项及既有23项纯门禁测试共44项通过。当前仍需日终就绪时点/修订、企业行动官方对账及云端连通性/CPU，最后才决定是否审批来源。A/H行情许可、深市日历、TARGET日历、事件完整性、年度维护、Wi-Fi、Kinde正式发信许可与迁移/回滚仍待完成。不能把找到免费候选、只读覆盖或通过本地测试说成真实日终已经上线。见[实测边界](massive-free-validation-v0.3.5.md)。

### 本机密钥配置

在交互式终端执行`node backend/scripts/configure-massive-key.mjs`，仅在隐藏输入提示中粘贴官方控制台Copy取得的API Key，按Enter。工具不会联网、不显示key、不在命令行参数中传递key，也不修改Cloudflare secret。它仅新建`backend/.massive-secrets.local.json`，权限0600，该文件由`*.local.json`忽略；已有文件和符号链接均拒绝覆写。不要用聊天、截图、公开报告或提交来传递密钥。后续读取脚本只能在请求官方API时使用认证头，不能将key写进URL、请求日志或探测报告。

[AV-D]: https://www.alphavantage.co/documentation/
[AV-S]: https://www.alphavantage.co/support/
[AV-T]: https://www.alphavantage.co/terms_of_service/
[TD-P]: https://twelvedata.com/pricing
[MS-P]: https://massive.com/pricing?product=stocks
[MS-T]: https://massive.com/legal/individuals-terms-of-service
[MS-M]: https://massive.com/legal/market-data-terms-of-service
[MS-C]: https://massive.com/docs/rest/stocks/aggregates/daily-ticker-summary
[ECB-R]: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
[ECB-L]: https://www.ecb.europa.eu/services/disclaimer/html/index.en.html
