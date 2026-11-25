# Massive个人免费账户只读验收：v0.3.5候选

日期：2026-11-25。官方账户UI确认Stocks Basic / Individual / $0每月，用户自行完成注册并通过本机隐藏输入工具配置密钥。本轮只验证公开标的NVDA，不请求个人持仓、不写D1、不部署Worker/Pages、不启用Cron，也不切换原App的腾讯来源。

## 实测结果

原始验证摘要见[不含价格序列的JSON报告](../../backend/massive-free-probes-v0.3.5.json)。2026-11-25 11:36:22—11:37:02 UTC进行4次认证GET，启动间隔13秒，均HTTP200并通过字段核验；没有请求付费升级。

| 接口 | 请求范围/口径 | 本次账户结果 |
| --- | --- | --- |
| [Daily Ticker Summary](https://massive.com/docs/rest/stocks/aggregates/daily-ticker-summary) `/v1/open-close/NVDA/2026-11-24` | 显式`adjusted=false`，只取`close`，不用`preMarket`或`afterHours` | 日期2026-11-24，代码和OHLC字段有效 |
| [Custom Bars](https://massive.com/docs/rest/stocks/aggregates/custom-bars) `/v2/aggs/ticker/NVDA/range/1/day/2025-11-25/2026-11-24` | 显式`adjusted=false`，升序，最多500行 | 返回251条，2025-11-25至2026-11-24，响应明确`adjusted:false`；无下一页 |
| `/v3/reference/splits?ticker=NVDA` | 执行日不晚于2026-11-24，倒序，最多100条 | 返回4条，2006-04-07至2024-06-10；无下一页 |
| `/v3/reference/dividends?ticker=NVDA` | 除息日2025-11-25至2026-11-24，最多100条 | 返回4条，2025-12-04至2026-09-10，金额为有限正数且币种USD；无下一页 |

2026-11-24最后一根未复权日线的`c`与同日摘要`close`一致。仅公布一致性布尔值和选定数据hash，不发布价格或事件明细。该对照只覆盖一天，不能推广成所有日线已证明采用常规最终收盘。

## 日期、复权和企业行动保护

- 日线时间戳按`America/New_York`解析，不能直接截UTC日期。当前样例日期升序、无重复且在请求区间内。未以交易所完整日历核对251条，不能宣称一年完全无缺日。
- 原始价请求和响应均明确。摘要没有返回复权确认字段，报告只声明请求口径，不伪造响应字段。默认复权价、实时价与盘前盘后价不作缺失回退。
- 企业行动访问成功不代表完整性。没有翻页压力测试，没有与官方公司公告逐项对照，也没有为用户账本生成持股变动或追加分红。
- 所有解析器只返回`valid-candidate`或`pending`，`finalityVerified`、`eventCompletenessVerified`、`ledgerReconciled`等保持false。没有向既有日终门禁批准Massive，也没有伪造`status:final`。

## 安全和本机运行

`backend/.massive-secrets.local.json`已检查为普通文件、0600，并由gitignore排除。密钥只通过curl配置的标准输入进入HTTPS认证头，不进URL、命令参数、报告或仓库。脚本固定`api.massive.com`，不跟随重定向，忽略个人curl默认配置，25秒网络超时，响应最多1MiB；401/429停止后续探测，不自动重试。

首轮Node fetch和不带密钥的诊断均遇到本机`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`，Node系统证书选项也未解决。随后macOS系统curl在正常TLS验证下连接成功，认证测试采用它完成；没有使用`-k`、关闭TLS、安装证书或修改系统信任。本机curl不是Worker运行时方案，不能由此声称Cloudflare到源的fetch已验证。

新增密钥工具、受限系统客户端和候选字段核验共21项测试；合并既有日终证据门禁的23项纯测试，本轮44项通过、0失败。既有完整Workerd回归先前未获执行许可，本轮没有重复尝试或声称全部后端测试已重跑。云端CPU及冷启动没有采样。

## 结论与后续

个人免费账户对上述NVDA请求可用，且本次能够读取一年未复权日线及拆股/分红字段。不能把一个标的扩成全部美股，更不能扩成A/H覆盖。2年历史、50标的、大响应、其他客户端共享5次/分额度和供应商服务保证尚未实测。

本次在北京时间19:36以后读取前一美股交易日，没有验证北京时间07:00时数据已经就绪；没有收盘后修订观测，后续失败或未就绪仍应保留pending而非记录错误日终。

适用边界仍见[个人服务条款](https://massive.com/legal/individuals-terms-of-service)和[Market Data Terms](https://massive.com/legal/market-data-terms-of-service)：本人的个人投资工具候选，不授予多用户公开共享行情许可。本轮不代替用户作资格声明、不批准生产源、不注册其他付费方案。

下一步先核对企业行动公告和原始日线/摘要差异，再做隔离的Cloudflare只读源连通性及新模块CPU/冷启动验证。云端secret配置另需受控处理，不能将本机密钥当成已经写入Cloudflare。正式迁移、真实定时补算、年度维护、备份/回滚和A/H输入仍未完成。
