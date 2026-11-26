# 个人美股真实云端只读验收：v0.3.6候选

记录日期：2026-11-25。用户明确同意将已配置的本机Massive API Key临时存入Cloudflare Secret，在独立、鉴权、最长1小时的Worker测试固定美股只读接口，结束后删除测试Worker和secret。本轮不改main、现有Worker/Pages或真实账本，不启用Cron、不增加付费方案；Massive仍为个人美股候选，许可不扩为公开多用户共享行情。

## 1. 隔离和密钥边界

- 独立`gaintrace-market-validation`，官方CLI配置Secret；密钥经stdin传入，不写入argv、代码、GitHub、响应或日志。本机会话/配置为gitignored的0600文件，且会话文件不包含源密钥。
- 官方CLI独立核验secret名称恰为`MASSIVE_API_KEY`与`VALIDATION_TOKEN`；官方设置仅有plain_text/secret_text绑定，无数据库，Cron为0。
- 开始2026-11-25 13:05:20.986UTC，截止14:05:20.986UTC，官方设置核验恰为1小时。鉴权及过期门禁在应用入口执行；这个时间限制本身不是secret物理删除，删除须另外核验。
- 入口仅固定只读NVDA摘要/日线、ECB参考汇率、5/50合成标的和收盘时间检查；拒绝未授权、写入、自定义源。源请求正常TLS，manual重定向且拒绝非2xx，有限时/响应体大小限制。
- CLI进程追加既有系统CA，不改系统信任或关闭TLS。客户端沿用官方DoH、原主机名TLS的诊断访问，不证明手机普通网络对workers.dev可达。
- 本轮四个验证脚本按是否携带源secret选择独立`market-massive-cloud-*`报告，保留前轮无源secret的`market-cloud-*`证据，不覆盖或混用。

## 2. 真实来源与对照

客户端窗口2026-11-25 13:06:12.388—13:07:37.476UTC，七次串行请求，间隔13秒：

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| NVDA 2026-11-24摘要 | 上游及入口HTTP200，valid-candidate，选定hash与本机首次样本一致 | 只用close、不用扩展时段；不宣称final |
| NVDA一年未复权日线 | 上游及入口HTTP200，251条，2025-11-25—2026-11-24，hash与本机一致 | adjustmentReturned=unadjusted、无更多页；不证明市场日历完整性 |
| ECB参考日汇率 | HTTP200，2026-11-24，CNY/USD/HKD，valid-candidate | ECB_REFERENCE，不是成交汇率，不发布数值 |
| 5/50混合市场证据 | 均HTTP200，verified-candidate | 明确synthetic，不是50只真实股票验证 |
| 当日收盘就绪门禁 | pending、regular-session-not-closed、上游请求0 | 美股11/25常规收盘尚未发生 |
| 未授权入口 | HTTP401 | 不调用行情源 |

本次Cloudflare到Massive真实fetch与解析已跑通；报告只保留元数据和hash，不发布原始价格/企业行动序列。与本机一致仅证明观察样本的选定内容一致，不保证未来不修订、所有标的齐全或北京时间07:00必定就绪。不能将valid-candidate解释为已经接上真实账本日终。

证据：[官方部署与隔离核验](../../backend/market-massive-cloud-deployment-v0.3.6.json)、[串行只读请求](../../backend/market-massive-cloud-checks-v0.3.6.json)。

## 3. CPU和回归

官方`workersInvocationsAdaptive`在13:06—13:08UTC外扩窗口报告7次请求、0运行时错误，最高观测桶CPU **16.749ms**，超过10ms参考线。单位为官方微秒除1000，不是网络耗时；不能用前轮4.676ms替代本轮结果，也不能把0运行时错误解释为免费CPU门槛已全部通过。

峰值桶为13:06:26UTC、1请求、0上游子请求，与5标的合成阶段时间对应；50标的阶段对应时间桶为8.197ms。包含上游请求的时间桶最高5.840ms。时间关联不足以证明逐请求路由归因、冷启动或具体慢因，尤其不能据此认定是Massive接口导致超线。前轮5标的时间桶2.609ms，与本轮并不稳定一致；暂无可重复、确定性的根因反馈环，因此没有凭猜测修改计算逻辑或声称已解决CPU峰值。

当前结论是“真实源连通和解析通过，所有负载的免费CPU余量未通过确认”。返回的自适应分析桶、请求总数相同也不证明逐次采样完整性、全部冷启动或未来负载。下一性能步骤应先构造重复、隔离的请求窗口定位波动，再评估优化或拆分；不把一次峰值推导为必定收费、必定失败或付费账户。

证据：[官方CPU样本](../../backend/market-massive-cloud-cpu-v0.3.6.json)。

本轮重新执行52项纯检查，全部通过；四个管理脚本语法检查通过。原生Workerd4项为前轮已通过结果，本轮未重跑全后端回归。候选Worker源码hash仍为`434a9edb023cbf9951a69655a3a4160ff2cb3b88a923af7873ee70974f7b57af`。

## 4. 清理和下一步

2026-11-26后续已完成两轮无源secret的合成5/50负载复测：客户端52次全部正常，官方第一轮最大9.822ms，第二轮最大9.606ms但计数缺1（25/26）。未观测到超线不代表已修复本报告的16.749ms；性能仍需调用级证据，真实行情入口和计算代码没有修改。两轮均已清理，详见[重复隔离报告](cpu-repeat-validation-v0.3.6.md)。

2026-11-25 13:08:46.007UTC独立核验测试Worker已删除、随附Massive和测试secret随资源移除；本机临时会话/部署配置已删。本机源密钥继续0600/gitignored保留，现有Worker存在且Cron为0，真实账本未写。见[独立清理证据](../../backend/market-massive-cloud-cleanup-v0.3.6.json)。

仍待实际收盘至次晨07:00的数据就绪和多时段修订观察、企业行动官方对账、更多标的/冷启动/大账本性能、A/H许可与日历、TARGET休市沿用和正式备份迁移确认。没有启动未来自动观察或真实日终Cron。当前账户订阅详情仍未完整核定，不声称所有使用规模永远免费。
