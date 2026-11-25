# 市场日历、收盘边界与企业行动：官方资料核查

核验窗口：2026-11-25 17:57:33–18:07:24 北京时间（09:57:33–10:07:24 UTC）。仅研究公开资料；未登录、付款、获取用户交易数据或启用数据源。本文服务于本地候选证据门禁，不是上线或真实迁移授权。

## 1. 已核定时段与时区

范围为现金股票常规竞价交易，不把盘前、盘后、期权、互联互通服务时间混作股票收盘。

| 市场 | 市场时区（IANA） | 常规时段（当地时间）及收盘边界 | 一手证据 |
| --- | --- | --- | --- |
| 沪深 A 股 | `Asia/Shanghai`，2026 年 UTC+08，无夏令时 | 开盘集合竞价 09:15–09:25；连续竞价 09:30–11:30、13:00–14:57；收盘集合竞价 14:57–15:00，常规收盘 15:00 | [上交所时段][SSE-T]、[上交所 2026 规则][SSE-R] §2.4、[HKEX 对 SSE/SZSE 的时段表][HK-T]、[IANA 亚洲数据][TZ-A]；深市时段有 HKEX 官方交叉证据，深交所自身页面未取得正文 |
| 港股 | `Asia/Hong_Kong`，UTC+08，无夏令时 | 开市前时段 09:00–09:30；普通股票连续交易 09:30–12:00、13:00–16:00；**CAS 证券正常日随机收市 16:08–16:10，半日随机收市 12:08–12:10** | [HKEX Trading Hours][HK-T]、[收市价定义][HK-M]、[IANA][TZ-A]、[香港天文台][HKO] |
| NYSE / Nasdaq | `America/New_York`，EST UTC−05 / EDT UTC−04 | 周一至周五常规 09:30–16:00；已公告半日市至 13:00，无午休 | [NYSE][NY]、[Nasdaq][NQ]、[IANA 北美数据][TZ-U] |

- 港股 CAS 从 16:00（半日 12:00）开始，不能提前把该时刻当 CAS 最终收盘。非 CAS 证券使用 HKEX 的五个 nominal price 中位数机制，不能假设所有证券都参与 CAS；中午延续交易也只按适用证券处理。[HK-T]、[HK-M]
- 上交所英文时段页年度表仍显示 2025，不能用它冒充 2026 日历。2026 版规则 §3.7 写有 A 股/ETF 盘后固定价 15:05–15:30、以竞价收盘价撮合；旧时段页的主板/科创板展示不同，具体业务启用范围与历史生效公告仍需另核，不能把盘后结束当作新的常规收盘价。[SSE-T]、[SSE-R]
- 美国现行 DST 是三月第二个星期日 02:00 开始、十一月第一个星期日 02:00 结束；据此换算 2026 年为 **03-08 / 11-01**。这是规则推导，不是交易所假期公告；北京时间正常美股交易为 EDT 21:30–次日 04:00、EST 22:30–次日 05:00。[NIST]、[TZ-U] 香港天文台列明 1980 至今不实行夏令时；IANA 中国 PRC 夏令时规则止于 1991 年，历史日期不能套用今天的固定偏移。[HKO]、[TZ-A]

## 2. 2026 年官方休市与早收市

以下是**已发布安排**，不是未来实际收盘观察；仍须接纳后续交易所特别公告。周末也休市，中国调休工作日不自动变成交易日。

- **沪市**：[中文年度表][SSE-C]列明 01-01–01-03、02-15–02-23、04-04–04-06、05-01–05-05、06-19–06-21、09-25–09-27、10-01–10-07 休市；另列 01-04、02-14、02-28、05-09、09-20、10-10 为周末休市。该表未列常规半日市，不代表不存在特别停市。
- **深市缺口**：[深交所服务入口][SZ]本次 HTTP 200 仅返回 `&nbsp`，浏览器亦无正文；未获得深交所 2026 年度公告，**年度日期待核定，不自动复制沪市日历**。HKEX 北向时段或北向休市不是深市本地年度日历。
- **港市**：[HKEX Calendar][HK-C]内嵌 `calendarDataSource.monthly` 中，`description="Hong Kong Market is closed"` 的 2026 日期为 01-01、02-17/18/19、04-03/06/07、05-01/25、06-19、07-01、09-26、10-01/19、12-25/26；其中 09-26、12-26 本已是周六。半日事件明确列 **02-16、12-24、12-31**，与 §1 的半日 CAS 时间配合使用。
- **美股**：[NYSE][NY]与[Nasdaq][NQ]独立一致：全日休市 01-01、01-19、02-16、04-03、05-25、06-19、07-03、09-07、**11-26（感恩节）**、12-25；**11-27、12-24 至 13:00 ET 早收市**。NYSE 的 13:15 脚注用于适用期权，不用于普通股票。
- 港交所日历同时包含内地假期、北向/南向、掉期及衍生品事件，必须筛选本地证券市场类别。其事件 `00:00–23:59` 是全日展示区间，**不是实际交易截止时间**。[HK-C] HKEX 自 2024-09-23 实施恶劣天气交易，不能沿用“台风/黑雨必定休市”的旧假设；异常停市另取正式通知。[HK-W]

## 3. 每日标签 D 等待次日北京时间 07:00：仅候选规则

**覆盖时钟边界，但不保证数据就绪。** 前提是明确关联 US 的纽约交易日 `D`，不是从交易录入日期猜测执行日；`D+1` 指自然次日，周末也一样。

| US 当地 D 的常规收市 | UTC | 北京时间 | 相对 D+1 07:00 |
| --- | --- | --- | --- |
| EDT 16:00 | D 20:00 | D+1 04:00 | 提前 3 小时 |
| EST 16:00 | D 21:00 | D+1 05:00 | 提前 2 小时 |
| EDT 13:00 半日（换算情形，未指称 2026 某日有此安排） | D 17:00 | D+1 01:00 | 提前 6 小时 |
| EST 13:00 半日 | D 18:00 | D+1 02:00 | 提前 5 小时 |

- 已公告 **2026-11-27 13:00 EST = 11-27T18:00Z = 北京 11-28 02:00**，故候选 11-28 07:00 在其后；11-26 全日休市没有当日新收盘价，不能制造“26 日真实收盘”。可按明示策略携带前一交易日价格，但必须保留原价格日期和休市原因。[NY]、[NQ]
- 用本机 `Intl.DateTimeFormat`/IANA 独立核对：03-06 收市→北京 03-07 05:00，03-09→03-10 04:00；10-30→10-31 04:00，11-02→11-03 05:00。07:00 在两侧均晚于常规收盘；这是时区换算检查，不是生产行情验收。[TZ-U]、[NIST]
- 港股即使等到 CAS 最晚 16:10/12:10，亦早于此候选时刻；但 07:00 **不覆盖所有美股盘后交易**（Nasdaq 常规盘后至 20:00 ET，冬季北京次日 09:00），也不证明迟报、价格修订、停牌、企业行动或 FX 已齐备。[HK-T]、[NQ]
- 用户补充的本地事实：`parts/data.js` 默认 `qfq`，`qt` 解析丢失原行情时间；交易仅有 `date` 与录入/排序 `ts`。本研究不把抓取时间/`ts` 当行情或成交时间，不把美国午夜后录入日期自动改成纽约执行日。标签 D、市场交易日、行情有效时间应分别记录；无法确认时留待核定。
- 最小候选证据应分别保留市场/交易日、时区、日历 URL/核验时间、计划收盘与实际收盘证据、价格原时间/复权口径、企业行动有效日期与 FX 日期。只有“过了 07:00”不满足确认门禁；固定北京时间 23:59 截止仍仅是免费 Pages/Workers+D1 **模拟边界**。本地门禁、IANA 转换、ECB 参考 FX 解析不等于已接入或激活真实源。

## 4. 企业行动、价格复权与持仓盈亏

**官方明确的事实**：上交所 2026 规则 §4.3 的除权除息参考价为 `[(前收盘价−现金红利)+配股价×流通股份变动比例] / (1+流通股份变动比例)`，除权日行情中的“前收盘价”展示该参考价。HKEX 也可在除权/生效日为拆合股、供股、红股、现金分红调整 previous closing price；条件未满足、金额未知等情形可不调整或显示 N/A。**调整前收盘参考价不等于把整段历史成交价复权。**[SSE-R]、[HK-M]

[SEC 除息说明][SEC-D]区分登记日、除息日与支付日：普通分红除息日通常为登记日，登记日非工作日则通常前一个工作日；金额达股价 25% 的特殊分红、派股及 due bill 可有不同规则。因此不能统一硬算“登记日前一天”，更不能套用现行规则覆盖全部历史事件。页面的 Company XYZ/2026 日期是教学示例，**不是已下载的真实企业行动**。FINRA §5330 是开放订单价格/数量调整规则，且含全国交易所规则适用例外，**不是统一持仓成本或历史行情复权规范**。[SEC-D]、[FINRA]

以下为基于上述事实的**候选账本推论，非交易所规定的应用盈亏算法**：

- 拆合股以有效公告中的新股/旧股比例 `r` 调整数量 `q×r`、单位成本 `cost/r`，总成本不因纯比例变动改变；未调整数量却使用除权后价格会制造盈亏。零碎股、现金替代、费用及生效条件必须取具体公告，不能擅自四舍五入。
- 使用未复权收盘价时，价格盈亏为 `数量×价格−剩余总成本`；总收益口径另计有权领取的分红/应收、税费等。除息确认应收和支付日收到现金是不同事件，转现金不重复确认收益。只计算价格盈亏可以不含分红，但必须命名清楚；未知税额/到账额不默认零。
- 前/后复权或总回报序列适合收益比较，但需提供商明确调整因子、拆股/现金分红覆盖、基准日和修订规则；不能与原始交易数量/成本混用，也不能在已含分红的收益序列上再次加分红。`qfq` 标签本身不是官方口径证明；本次未核定该提供商算法，未下载其因子。

| 可查询的一手源 | 可核实内容与本次缺口 |
| --- | --- |
| [上交所公司公告][SSE-A] | 已取得检索页面，明确内容由上市公司提供；可按公司/日期找权益分派实施等公告。本次未下载个股历史事件，不能声称已构建完整事件库。 |
| [深交所官网][SZ] | 自身网页正文不可用；深市事件检索、年度公告、历史完整性及字段均待补查。 |
| [HKEXnews 标题检索][HK-A] + [HKEX 调整指引][HK-M] | 已取得公开检索页面/规则；公告用于确认派息、拆合股比例、除权/登记/支付日及条件。本次未拉取个股事件或历史原始价格。 |
| [SEC EDGAR API 文档][SEC-A]（覆盖 NYSE/Nasdaq 发行人申报） | 无认证/API key 的 submissions 历史及 XBRL companyfacts；应跟随历史分片、申报正文及附件找事件。XBRL API 仅聚合非自定义且适用于整个申报实体的事实，不能当完整企业行动流水或收盘价库。本次只核读文档，未下载发行人 JSON/申报。 |

尚未核定可免费、无账户取得的**全股票/全历史、明确未复权或复权因子、带有效行情时间的官方日价与企业行动组合**；公开网页可读也不等于批量 API 稳定、授权可再分发。NYSE 尝试路径 `/market-data/reference/nyse-corporate-actions` 返回 404，不列为可用产品。行情网站、模拟日历、SEC 教学示例均不得标作官方市场历史数据。

## 5. 获取方式与引用

HTTP 下载至临时目录的是 NYSE 日历 HTML、HKEX 时段/机制/日历 HTML（含事件 JSON）及辅助脚本、上交所时段/中文日历/公告检索 HTML、**2026 交易规则 PDF**、FINRA 规则、NIST/HKO 页面与 IANA 文本；不是历史行情或全量企业行动数据。Nasdaq 年度表/时段、SEC 除息与 EDGAR API 文档通过浏览器核读；其 PDF/ZIP/API 链接未据此视为已下载。HTTP 成功码须结合正文核验，404、403、空正文不作事实依据。研究文件仅保存摘要和 URL，临时快照不是仓库交付物。

[SSE-T]: https://english.sse.com.cn/start/trading/schedule/
[SSE-R]: https://english.sse.com.cn/start/sserules/stocks/trading/c/10825757/files/d263e3a87f37436ca2f8e5bcfc4ff001.pdf
[SSE-C]: https://www.sse.com.cn/disclosure/dealinstruc/closed/
[SSE-A]: https://www.sse.com.cn/disclosure/listedinfo/announcement/
[SZ]: https://www.szse.cn/English/services/
[HK-T]: https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours?sc_lang=en
[HK-M]: https://www.hkex.com.hk/Services/Trading/Securities/Overview/Trading-Mechanism?sc_lang=en
[HK-C]: https://www.hkex.com.hk/News/HKEX-Calendar?sc_lang=en
[HK-W]: https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Severe-Weather-Arrangements?sc_lang=en
[HK-A]: https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=en
[NY]: https://www.nyse.com/markets/hours-calendars
[NQ]: https://www.nasdaq.com/market-activity/stock-market-holiday-schedule
[NIST]: https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst
[HKO]: https://www.hko.gov.hk/en/gts/time/Summertime.htm
[TZ-A]: https://data.iana.org/time-zones/tzdb/asia
[TZ-U]: https://data.iana.org/time-zones/tzdb/northamerica
[FINRA]: https://www.finra.org/rules-guidance/rulebooks/finra-rules/5330
[SEC-D]: https://www.investor.gov/introduction-investing/investing-basics/glossary/ex-dividend-dates-when-are-you-entitled-stock-and
[SEC-A]: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
